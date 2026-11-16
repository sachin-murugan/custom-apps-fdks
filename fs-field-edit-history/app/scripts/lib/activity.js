// Single-record and workflow pages: which one is open, a record's activity timeline, and a
// workflow's action history. Same endpoints as the record's Activities tab and the workflow's
// "View history" dialog.
(function (root) {
  const FSX = (root.FSX = root.FSX || {});
  const { inRange } = FSX.history;

  const RECORD_MODULES = {
    contacts: { entity: 'contact', endpoint: 'contacts' },
    deals: { entity: 'deal', endpoint: 'deals' },
    accounts: { entity: 'sales_account', endpoint: 'sales_accounts' },
    sales_accounts: { entity: 'sales_account', endpoint: 'sales_accounts' },
  };

  function pathOf(href) {
    try {
      const url = new URL(href);
      return { host: url.host, path: url.pathname + url.hash.replace(/^#/, '') };
    } catch (_e) {
      return null;
    }
  }

  /** { host, entity, endpoint, recordId } for /contacts/123 (classic) or /crm/sales/deals/123, else null. */
  function parseRecordUrl(href) {
    const u = pathOf(href);
    const m = u && u.path.match(/^(?:\/crm\/sales)?\/(contacts|deals|accounts|sales_accounts)\/(\d+)(?:[/?#]|$)/);
    return m ? { host: u.host, ...RECORD_MODULES[m[1]], recordId: m[2] } : null;
  }

  /** { host, workflowId } for /crm/sales/workflow-automations/<category>/<id>(/edit), else null. */
  function parseWorkflowUrl(href) {
    const u = pathOf(href);
    const m = u && u.path.match(/\/workflow-automations\/[\w-]+\/(\d+)(?:[/?#]|$)/);
    return m ? { host: u.host, workflowId: m[1] } : null;
  }

  const webPaths = (client, suffix) =>
    client.style.platform === 'classic' ? [suffix, `/crm/sales${suffix}`] : [`/crm/sales${suffix}`, suffix];

  /** Every timeline entry for one record (all activity types), newest first, within [fromMs, toMs]. */
  async function fetchTimeline(client, mod, id, { fromMs = null, toMs = null, signal, onPage = () => {} } = {}) {
    let paths = webPaths(client, `/${mod.endpoint}/${id}/timeline_feeds`);
    const users = {};
    const rows = [];
    for (let page = 1; ; page++) {
      if (signal && signal.aborted) throw new Error('Export cancelled');
      const { data, path } = await client.getFirst(paths, { page, include: 'user,targetable' }, {
        accept: (d) => d && Array.isArray(d.timeline_feeds),
      });
      paths = [path];
      (data.users || []).forEach((u) => (users[u.id] = u.display_name || u.email));
      const items = data.timeline_feeds;
      rows.push(...items.filter((a) => inRange(a.created_at, fromMs, toMs)).map((a) => timelineRow(a, users)));
      onPage(page, rows.length);
      if (!(data.meta && data.meta.has_next) || !items.length) break;
    }
    return rows;
  }

  function timelineRow(a, users) {
    return {
      Time: a.created_at,
      Activity: a.action_type,
      Group: a.group && a.group.name,
      'Related to': [a.targetable_type, a.targetable_name].filter(Boolean).join(': '),
      'Related ID': a.targetable_id,
      'Done by': a.user_id != null ? users[a.user_id] || a.user_id : '',
      Automation: a.automation,
      Details: a.action_data,
    };
  }
  const TIMELINE_COLUMNS = ['Time', 'Activity', 'Group', 'Related to', 'Related ID', 'Done by', 'Automation', 'Details'];

  // The "View history" dialog always sends DD/MM/YYYY, whatever the account's display format.
  const ddmmyyyy = (ms) => {
    const d = new Date(ms);
    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
  };
  const DAY = 24 * 60 * 60 * 1000;

  /** Query for one page of a workflow's actions; the range is padded a day, exact bounds applied after. */
  function workflowParams(workflowId, fromMs, toMs, now = Date.now()) {
    return {
      'filter[0][attribute]': 'time_period',
      'filter[0][operator]': 'is_in_the_range',
      'filter[0][value][]': [fromMs == null ? '01/01/2000' : ddmmyyyy(fromMs - DAY), ddmmyyyy((toMs == null ? now : toMs) + DAY)],
      'filter[1][attribute]': 'status',
      'filter[1][value]': 'all',
      'filter[2][attribute]': 'workflow_automation_id',
      'filter[2][value]': workflowId,
    };
  }

  /** Every action the workflow ran (successful and failed) within [fromMs, toMs], newest first. */
  async function fetchWorkflowHistory(client, workflowId, { fromMs = null, toMs = null, signal, onPage = () => {} } = {}) {
    let paths = webPaths(client, '/workflow_automations/audit_logs');
    const rows = [];
    let token = null;
    for (let page = 1; ; page++) {
      if (signal && signal.aborted) throw new Error('Export cancelled');
      const params = workflowParams(workflowId, fromMs, toMs);
      if (token) params.next_token = token;
      const { data, path } = await client.getFirst(paths, params, {
        accept: (d) => d && Array.isArray(d.workflow_automation_action_history),
      });
      paths = [path];
      const items = data.workflow_automation_action_history;
      rows.push(...items.filter((a) => inRange(a.triggered_timestamp, fromMs, toMs)).map(workflowRow));
      onPage(page, rows.length);
      token = data.meta && data.meta.next;
      if (!token || !items.length) break;
    }
    return rows;
  }

  function workflowRow(a) {
    const src = a.source_entity || {};
    return {
      'Triggered at': a.triggered_timestamp,
      Status: a.status,
      Action: a.action_type,
      'Action details': Array.isArray(a.action_details) ? a.action_details.join('; ') : a.action_details,
      Message: a.message,
      'Record type': src.type,
      'Record ID': src.id,
      'Record name': src.name,
      'Record deleted': src.is_deleted,
    };
  }
  const WORKFLOW_COLUMNS = ['Triggered at', 'Status', 'Action', 'Action details', 'Message', 'Record type', 'Record ID', 'Record name', 'Record deleted'];

  async function fetchWorkflowName(client, workflowId) {
    try {
      const { data } = await client.getFirst(webPaths(client, `/workflow_automations/${workflowId}`));
      return (data && data.workflow_automation && data.workflow_automation.name) || null;
    } catch (_e) {
      return null;
    }
  }

  /** A record's display name from the REST API, or null. */
  async function fetchRecordName(client, mod, id) {
    try {
      const { data } = await client.getFirst(client.apiPaths(`${mod.endpoint}/${id}`));
      return FSX.history.recordName(data && (data[mod.entity] || data[mod.endpoint])) || null;
    } catch (_e) {
      return null;
    }
  }

  FSX.activity = {
    parseRecordUrl,
    parseWorkflowUrl,
    fetchTimeline,
    fetchWorkflowHistory,
    fetchWorkflowName,
    fetchRecordName,
    workflowParams,
    TIMELINE_COLUMNS,
    WORKFLOW_COLUMNS,
  };
})(globalThis);
