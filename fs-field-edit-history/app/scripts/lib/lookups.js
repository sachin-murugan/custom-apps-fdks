// Maps lookup IDs (lifecycle stage, owner, territory, ...) to display names.
// Ported from crm_export/lookups.py.
(function (root) {
  const FSX = (root.FSX = root.FSX || {});

  const SELECTOR_RESOURCES = [
    'lifecycle_stages', 'contact_statuses', 'lead_sources', 'territories', 'lost_reasons',
    'campaigns', 'deal_pipelines', 'deal_stages', 'deal_types', 'deal_reasons', 'deal_products',
    'deal_payment_statuses', 'industry_types', 'business_types', 'lead_stages', 'lead_reasons',
  ];

  // Top-level *_id field -> lookup bucket.
  const ID_FIELD_TO_BUCKET = {
    lifecycle_stage_id: 'lifecycle_stages',
    contact_status_id: 'contact_statuses',
    lead_source_id: 'lead_sources',
    source_id: 'lead_sources',
    territory_id: 'territories',
    lost_reason_id: 'lost_reasons',
    campaign_id: 'campaigns',
    owner_id: 'users',
    creater_id: 'users',
    updater_id: 'users',
    deal_pipeline_id: 'deal_pipelines',
    deal_stage_id: 'deal_stages',
    deal_type_id: 'deal_types',
    deal_reason_id: 'deal_reasons',
    deal_product_id: 'deal_products',
    deal_payment_status_id: 'deal_payment_statuses',
    industry_type_id: 'industry_types',
    business_type_id: 'business_types',
    lead_stage_id: 'lead_stages',
    lead_reason_id: 'lead_reasons',
    sales_account_id: 'sales_accounts',
    product_id: 'products',
    currency_id: 'currencies',
    record_type_id: 'record_types',
  };

  // Nested association key -> [id column, name column, bucket].
  const NESTED_ASSOCIATIONS = {
    lifecycle_stage: ['lifecycle_stage_id', 'lifecycle_stage_name', 'lifecycle_stages'],
    contact_status: ['contact_status_id', 'contact_status_name', 'contact_statuses'],
    lead_source: ['lead_source_id', 'lead_source_name', 'lead_sources'],
    source: ['lead_source_id', 'lead_source_name', 'lead_sources'],
    territory: ['territory_id', 'territory_name', 'territories'],
    lost_reason: ['lost_reason_id', 'lost_reason_name', 'lost_reasons'],
    campaign: ['campaign_id', 'campaign_name', 'campaigns'],
    owner: ['owner_id', 'owner_name', 'users'],
    creater: ['creater_id', 'creater_name', 'users'],
    updater: ['updater_id', 'updater_name', 'users'],
    deal_pipeline: ['deal_pipeline_id', 'deal_pipeline_name', 'deal_pipelines'],
    deal_stage: ['deal_stage_id', 'deal_stage_name', 'deal_stages'],
    deal_type: ['deal_type_id', 'deal_type_name', 'deal_types'],
    deal_reason: ['deal_reason_id', 'deal_reason_name', 'deal_reasons'],
    deal_product: ['deal_product_id', 'deal_product_name', 'deal_products'],
    deal_payment_status: ['deal_payment_status_id', 'deal_payment_status_name', 'deal_payment_statuses'],
    industry_type: ['industry_type_id', 'industry_type_name', 'industry_types'],
    business_type: ['business_type_id', 'business_type_name', 'business_types'],
    lead_stage: ['lead_stage_id', 'lead_stage_name', 'lead_stages'],
    lead_reason: ['lead_reason_id', 'lead_reason_name', 'lead_reasons'],
    sales_account: ['sales_account_id', 'sales_account_name', 'sales_accounts'],
    currency: ['currency_id', 'currency_name', 'currencies'],
  };

  const DISPLAY_KEYS = ['display_name', 'name', 'value', 'type', 'label', 'email'];

  function displayFromObj(obj) {
    for (const key of DISPLAY_KEYS) {
      const val = obj && obj[key];
      if (val !== null && val !== undefined && val !== '') return String(val);
    }
    return null;
  }

  function idFieldToNameField(field) {
    return field.endsWith('_id') ? `${field.slice(0, -3)}_name` : `${field}_name`;
  }

  function normalizeBucket(lookupType) {
    let t = lookupType.trim().toLowerCase().replace(/-/g, '_');
    if (!t.endsWith('s')) t += 's';
    const mapping = {
      user: 'users', contact: 'contacts', deal: 'deals',
      sales_account: 'sales_accounts', lead: 'leads', product: 'products',
    };
    return mapping[t.replace(/s+$/, '')] || t;
  }

  function itemsFromResponse(data, bucket) {
    if (Array.isArray(data)) return data.filter((x) => x && typeof x === 'object');
    for (const key of [bucket, bucket.replace(/s$/, '') + 'es', 'data', 'results']) {
      const val = data && data[key];
      if (Array.isArray(val)) return val.filter((x) => x && typeof x === 'object');
    }
    return [];
  }

  class LookupRegistry {
    constructor() {
      this.entities = {}; // bucket -> id -> object
      this.lookupFields = {}; // cf_* -> bucket
    }

    register(bucket, entity) {
      if (!entity || entity.id === null || entity.id === undefined) return;
      (this.entities[bucket] = this.entities[bucket] || {})[String(entity.id)] = entity;
    }

    ingestLookupInformation(payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
      for (const [bucket, items] of Object.entries(payload)) {
        if (!Array.isArray(items)) continue;
        for (const item of items) if (item && typeof item === 'object') this.register(bucket, item);
      }
    }

    displayName(bucket, id) {
      if (id === null || id === undefined || id === '') return null;
      const entity = (this.entities[bucket] || {})[String(id)];
      return entity ? displayFromObj(entity) : null;
    }

    resolveIdField(field, id) {
      const bucket = ID_FIELD_TO_BUCKET[field];
      if (bucket) return this.displayName(bucket, id);
      if (field.startsWith('cf_') && this.lookupFields[field]) {
        return this.displayName(this.lookupFields[field], id);
      }
      return null;
    }

    registerFieldLookup(fld) {
      if (!fld || typeof fld.name !== 'string') return;
      const type = String(fld.type || fld.field_type || '').toLowerCase();
      if (!['lookup', 'auto_complete', 'autocomplete'].includes(type)) return;
      const lookupType = fld.lookup_type || fld.reference_type;
      if (lookupType) this.lookupFields[fld.name] = normalizeBucket(String(lookupType));
    }

    async loadSelectors(client, log = () => {}) {
      await Promise.all(
        SELECTOR_RESOURCES.map(async (resource) => {
          try {
            const { data } = await client.getFirst(client.selectorPaths(resource));
            const items = itemsFromResponse(data, resource);
            items.forEach((item) => this.register(resource, item));
            if (items.length) log(`Loaded ${items.length} ${resource}`);
          } catch (_e) {
            // Selector not available on this account/plan; names fall back to include data.
          }
        })
      );
      for (const resource of ['owners', 'users']) {
        try {
          const { data } = await client.getFirst(client.selectorPaths(resource));
          for (const key of ['users', 'owners']) {
            for (const item of (data && data[key]) || []) this.register('users', item);
          }
          log(`Loaded ${Object.keys(this.entities.users || {}).length} users/owners`);
          break;
        } catch (_e) {
          continue;
        }
      }
    }

    async loadFieldDefinitions(client, entity, endpoint, custom) {
      const paths = custom
        ? [
            ...client.settingsPaths(`custom_module/${entity}/fields`),
            ...client.apiPaths(`settings/custom_module/${entity}/fields`),
          ]
        : [...client.settingsPaths(`${endpoint}/fields`), ...client.apiPaths(`settings/${endpoint}/fields`)];
      try {
        const { data } = await client.getFirst(paths);
        for (const fld of (data && data.fields) || []) this.registerFieldLookup(fld);
      } catch (_e) {
        // Field metadata is optional; custom lookup names just won't resolve.
      }
    }
  }

  FSX.lookups = {
    SELECTOR_RESOURCES,
    ID_FIELD_TO_BUCKET,
    NESTED_ASSOCIATIONS,
    LookupRegistry,
    displayFromObj,
    idFieldToNameField,
  };
})(globalThis);
