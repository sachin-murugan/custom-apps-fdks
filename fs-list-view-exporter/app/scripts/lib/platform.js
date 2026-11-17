// Platform detection and API path styles for Classic Freshsales (*.freshsales.io)
// and Freshworks CRM (*.myfreshworks.com / *.freshworks.com). Ported from crm_export/config.py.
(function (root) {
  const FSX = (root.FSX = root.FSX || {});

  const CLASSIC = {
    platform: 'classic',
    label: 'Classic Freshsales (.freshsales.io)',
    apiFallbacks: ['/api', ''],
    settingsFallbacks: ['/settings', '/api/settings'],
    selectorFallbacks: ['/api/selector', '/selector'],
  };

  const CRM = {
    platform: 'crm',
    label: 'Freshworks CRM (.myfreshworks.com / .freshworks.com)',
    apiFallbacks: ['/crm/sales/api', '/crm/sales'],
    settingsFallbacks: ['/crm/sales/settings', '/crm/sales/api/settings'],
    selectorFallbacks: ['/crm/sales/selector', '/crm/sales/api/selector'],
  };

  function detectPlatform(host) {
    const h = String(host || '').toLowerCase();
    if (h === 'freshsales.io' || h.endsWith('.freshsales.io')) return 'classic';
    // Unknown hosts prefer CRM paths first, then classic (universal fallback).
    return 'crm';
  }

  function pathStyleFor(host) {
    return detectPlatform(host) === 'classic' ? CLASSIC : CRM;
  }

  function otherStyle(style) {
    return style.platform === 'crm' ? CLASSIC : CRM;
  }

  function joinPrefix(prefix, suffix) {
    const s = suffix.startsWith('/') ? suffix : `/${suffix}`;
    if (!prefix) return s;
    return prefix.replace(/\/+$/, '') + s;
  }

  // Module slug in the web app URL -> { entity, endpoint } used by the API.
  const URL_MODULES = {
    contacts: { entity: 'contact', endpoint: 'contacts' },
    deals: { entity: 'deal', endpoint: 'deals' },
    accounts: { entity: 'sales_account', endpoint: 'sales_accounts' },
    sales_accounts: { entity: 'sales_account', endpoint: 'sales_accounts' },
    leads: { entity: 'lead', endpoint: 'leads' },
    products: { entity: 'product', endpoint: 'products' },
    cpq_documents: { entity: 'cpq_document', endpoint: 'cpq_documents' },
  };

  /**
   * Work out which module and saved view the user is looking at from the page URL.
   * Handles both /contacts/view/123 (classic) and /crm/sales/contacts/view/123 (CRM),
   * plus custom modules at /custom_module/cm_foo/view/123. Returns null if the page
   * isn't a list view.
   */
  function parseListViewUrl(href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    const path = url.pathname + url.hash.replace(/^#/, '');
    const custom = path.match(/\/custom_module\/([\w-]+)\/view\/(\d+)/);
    if (custom) {
      return {
        host: url.host,
        entity: custom[1],
        endpoint: custom[1],
        custom: true,
        viewId: custom[2],
      };
    }
    // Products and CPQ documents may sit under /cpq/ in the web app (to verify on a live account).
    const std = path.match(
      /\/(?:cpq\/)?(contacts|deals|accounts|sales_accounts|leads|products|cpq_documents)\/view\/(\d+)/
    );
    if (std) {
      const mod = URL_MODULES[std[1]];
      return { host: url.host, entity: mod.entity, endpoint: mod.endpoint, custom: false, viewId: std[2] };
    }
    return null;
  }

  // From freshsales frontend include-params.js (via the desktop exporter).
  const LIST_INCLUDES = {
    contact:
      'owner,sales_accounts,creater,source,updater,campaign,contact_status,' +
      'lead_score_information,territory,emails,lookup_information,lists,' +
      'lifecycle_stage,lost_reason,tags,lead_source',
    deal:
      'owner,creater,updater,contacts,sales_account,deal_pipeline,deal_stage,' +
      'deal_type,territory,currency,source,deal_reason,campaign,deal_product,' +
      'deal_payment_status,lookup_information,tags',
    lead:
      'owner,lead_stage,source,updater,territory,lead_reason,campaign,creater,' +
      'lead_score_information,emails,lookup_information,tags',
    sales_account:
      'owner,contacts,updater,territory,industry_type,business_type,creater,' +
      'child_sales_accounts,lookup_information,tags',
    product: 'owner,creater,updater,lookup_information,tags',
    cpq_document: 'signatures,owner,creater,updater,lookup_information,tags',
  };
  // The detail API accepts a few more associations than list pages.
  const DETAIL_INCLUDES = {
    contact: `${LIST_INCLUDES.contact},phone_numbers`,
    deal: `${LIST_INCLUDES.deal},deal_freddy_metrics`,
    lead: `${LIST_INCLUDES.lead},company,deal`,
    sales_account: `${LIST_INCLUDES.sales_account},parent_sales_account,entity_team_users`,
  };
  const CUSTOM_MODULE_INCLUDES = 'creater,updater,lookup_information,territory';

  function listIncludesFor(entity, custom) {
    if (custom) return CUSTOM_MODULE_INCLUDES;
    return LIST_INCLUDES[entity] || 'lookup_information,owner,territory,tags';
  }

  function detailIncludesFor(entity, custom) {
    if (custom) return CUSTOM_MODULE_INCLUDES;
    return DETAIL_INCLUDES[entity] || listIncludesFor(entity, false);
  }

  /** Products and CPQ documents are listed through /cpq/<endpoint>?segment_id=<view>. */
  function isCpq(mod) {
    return !mod.custom && (mod.entity === 'product' || mod.entity === 'cpq_document');
  }

  FSX.platform = {
    CLASSIC,
    CRM,
    detectPlatform,
    pathStyleFor,
    otherStyle,
    joinPrefix,
    parseListViewUrl,
    listIncludesFor,
    detailIncludesFor,
    isCpq,
  };
})(globalThis);
