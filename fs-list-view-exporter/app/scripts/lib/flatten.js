// Flattens nested CRM records into CSV-ready rows with paired *_id / *_name columns.
// Ported from crm_export/flatten.py.
(function (root) {
  const FSX = (root.FSX = root.FSX || {});
  const { ID_FIELD_TO_BUCKET, NESTED_ASSOCIATIONS, displayFromObj, idFieldToNameField } = FSX.lookups;

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isContainer = (v) => v !== null && typeof v === 'object';
  const isBlank = (v) => v === null || v === undefined || v === '';

  // Association objects that are already covered by id/name columns.
  const SKIP_NESTED = new Set([
    ...Object.keys(NESTED_ASSOCIATIONS),
    'owner', 'creater', 'updater', 'territory', 'campaign', 'lifecycle_stage', 'contact_status',
    'lead_stage', 'deal_stage', 'deal_pipeline', 'sales_account', 'lookup_information',
  ]);

  /** Recursive merge used to lay detail-API payloads over list rows; custom_field is replaced whole. */
  function deepMerge(base, overlay) {
    const out = { ...base };
    for (const [key, value] of Object.entries(overlay || {})) {
      out[key] = key !== 'custom_field' && isObj(out[key]) && isObj(value) ? deepMerge(out[key], value) : value;
    }
    return out;
  }

  function scalar(value) {
    return isContainer(value) ? JSON.stringify(value) : value;
  }

  function expandCustomField(record) {
    const out = { ...record };
    const custom = out.custom_field;
    delete out.custom_field;
    if (isObj(custom)) Object.assign(out, custom);
    return out;
  }

  function applyNestedAssociations(record, flat, registry) {
    for (const [key, [idCol, nameCol, bucket]] of Object.entries(NESTED_ASSOCIATIONS)) {
      const obj = record[key];
      if (!isObj(obj)) continue;
      if (registry) registry.register(bucket, obj);
      if (!isBlank(obj.id)) flat[idCol] = obj.id;
      let name = displayFromObj(obj);
      if (name === null && registry && !isBlank(obj.id)) name = registry.displayName(bucket, obj.id);
      if (name !== null) flat[nameCol] = name;
    }
  }

  function applyTopLevelIds(record, flat) {
    for (const [key, value] of Object.entries(record)) {
      if (key.endsWith('_id') && !isContainer(value) && !isBlank(value)) flat[key] = value;
    }
  }

  function resolveMissingNames(flat, registry) {
    if (!registry) return;
    const needsName = (field) => isBlank(flat[idFieldToNameField(field)]);

    for (const [idField, bucket] of Object.entries(ID_FIELD_TO_BUCKET)) {
      if (!(idField in flat) || !needsName(idField)) continue;
      const resolved = registry.displayName(bucket, flat[idField]);
      if (resolved) flat[idFieldToNameField(idField)] = resolved;
    }
    for (const [field, value] of Object.entries(flat)) {
      if (!field.endsWith('_id') || isBlank(value) || !needsName(field)) continue;
      const resolved = registry.resolveIdField(field, value);
      if (resolved) flat[idFieldToNameField(field)] = resolved;
    }
    for (const [field, value] of Object.entries(flat)) {
      if (!field.startsWith('cf_') || field.endsWith('_name') || isBlank(value) || isContainer(value)) continue;
      if (!isBlank(flat[`${field}_name`])) continue;
      const resolved = registry.resolveIdField(field, value);
      if (resolved) flat[`${field}_name`] = resolved;
    }
  }

  function flattenValue(prefix, value, out) {
    if (value === null || value === undefined) {
      if (prefix && !prefix.endsWith('_id') && !(prefix in out)) out[prefix] = '';
      return;
    }
    if (isObj(value)) {
      if (SKIP_NESTED.has(prefix)) return;
      if (prefix === 'custom_field' || prefix.endsWith('_custom_field')) {
        for (const [k, v] of Object.entries(value)) {
          out[k.startsWith('cf_') ? k : `${prefix}_${k}`] = scalar(v);
        }
        return;
      }
      for (const [k, v] of Object.entries(value)) {
        const child = prefix ? `${prefix}_${k}` : k;
        if (child.endsWith('_id') && !isContainer(v)) {
          if (!isBlank(v)) out[child] = v;
        } else {
          flattenValue(child, v, out);
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      if (!value.length) {
        if (prefix && !(prefix in out)) out[prefix] = '';
        return;
      }
      if (value.every((item) => !isContainer(item))) {
        out[prefix] = value.map(String).join(', ');
        return;
      }
      value.forEach((item, idx) => {
        if (isObj(item)) {
          const name = displayFromObj(item);
          if (!isBlank(item.id) && prefix) out[`${prefix}_${idx}_id`] = item.id;
          if (name && prefix) out[`${prefix}_${idx}_name`] = name;
          for (const [k, v] of Object.entries(item)) {
            if (k === 'id' || k === 'name' || k === 'display_name') continue;
            flattenValue(`${prefix}_${idx}_${k}`, v, out);
          }
        } else {
          out[`${prefix}_${idx}`] = scalar(item);
        }
      });
      return;
    }
    if (prefix) out[prefix] = value;
  }

  function flattenRecord(record, registry) {
    if (registry && isObj(record.lookup_information)) {
      registry.ingestLookupInformation(record.lookup_information);
    }
    const expanded = expandCustomField(record);
    const flat = {};

    applyTopLevelIds(expanded, flat);
    applyNestedAssociations(expanded, flat, registry);

    const skipKeys = new Set([...Object.keys(NESTED_ASSOCIATIONS), 'custom_field', 'lookup_information']);
    for (const [key, value] of Object.entries(expanded)) {
      if (skipKeys.has(key)) continue;
      if (key.endsWith('_id') && !isContainer(value)) continue;
      flattenValue(key, value, flat);
    }

    resolveMissingNames(flat, registry);

    for (const [field, value] of Object.entries(flat)) {
      if (!field.endsWith('_id') || isBlank(value)) continue;
      const nameField = idFieldToNameField(field);
      if (!(nameField in flat)) flat[nameField] = '';
    }
    return flat;
  }

  /** Column order: id first, then the rest alphabetically (matches the desktop app's sorted union). */
  function unionFieldnames(rows) {
    const keys = new Set();
    rows.forEach((row) => Object.keys(row).forEach((k) => keys.add(k)));
    const sorted = [...keys].sort();
    const i = sorted.indexOf('id');
    if (i > 0) sorted.unshift(...sorted.splice(i, 1));
    return sorted;
  }

  FSX.flatten = {
    deepMerge,
    flattenRecord,
    flattenRecords: (records, registry) => records.map((r) => flattenRecord(r, registry)),
    unionFieldnames,
  };
})(globalThis);
