/**
 * CRM module types - Contacts, Accounts, Leads, Opportunities, Activities,
 * Automations, Scoring, Email Templates, Drip Campaigns, and more.
 */

// ============================================================================
// Core Entities
// ============================================================================

export interface CrmContact {
  ulid: string;
  first_name: string;
  last_name: string;
  full_name: string;
  title?: string;
  department?: string;
  birthday?: string;
  lead_source?: string;
  account?: { ulid: string; name: string };
  owner?: { ulid: string; name: string };
  emails?: { email: string; label?: string; is_primary: boolean }[];
  phones?: { phone: string; label?: string; is_primary: boolean }[];
  tags?: { id: number; name: string; color?: string }[];
  created_at?: string;
  updated_at?: string;
}

export interface CrmAccountContact {
  ulid: string;
  full_name: string;
  email?: string;
  title?: string;
}

export interface CrmAccount {
  ulid: string;
  name: string;
  website?: string;
  industry?: string;
  employee_count?: number;
  annual_revenue?: number;
  type?: string;
  ownership?: string;
  contacts?: CrmAccountContact[];
  owner?: { ulid: string; name: string };
  addresses?: {
    label?: string;
    street?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
    is_primary: boolean;
  }[];
  contacts_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface CrmLead {
  ulid: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  additional_emails?: string[];
  phone?: string;
  additional_phones?: string[];
  company?: string;
  status: string;
  lead_source?: string;
  score: number;
  score_tier?: string;
  owner?: { ulid: string; name: string };
  created_at?: string;
  updated_at?: string;
}

export interface CrmOpportunityContact {
  ulid: string;
  full_name: string;
  title?: string;
  role: "decision_maker" | "champion" | "influencer" | "end_user" | "blocker";
  email?: string;
}

export interface CrmOpportunityProduct {
  id: number;
  name: string;
  sku?: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
  sort_order: number;
}

export interface CrmOpportunity {
  ulid: string;
  name: string;
  amount: number;
  currency: string;
  expected_close_date?: string;
  original_close_date?: string;
  pipeline?: { ulid: string; name: string };
  stage: string;
  stage_entered_at?: string;
  stage_changed_by?: { ulid: string; name: string };
  probability: number;
  type?: string;
  account?: { ulid: string; name: string };
  primary_contact?: { ulid: string; full_name: string };
  contacts?: CrmOpportunityContact[];
  products?: CrmOpportunityProduct[];
  owner?: { ulid: string; name: string };
  created_at?: string;
  updated_at?: string;
}

// ============================================================================
// Paginated Response
// ============================================================================

export interface CrmPaginatedResponse<T> {
  data: T[];
  links?: { first: string; last: string; prev?: string; next?: string };
  meta?: {
    current_page: number;
    from?: number;
    last_page: number;
    per_page: number;
    to?: number;
    total: number;
  };
}

// ============================================================================
// Lead Conversion
// ============================================================================

export interface CrmConvertLeadResponse {
  contact: CrmContact;
  account: CrmAccount | null;
  opportunity: CrmOpportunity | null;
}

// ============================================================================
// Forecast & Pipeline
// ============================================================================

export interface CrmForecastResponse {
  total_pipeline: number;
  weighted_pipeline: number;
  open_count: number;
  by_stage: Array<{
    stage: string;
    count: number;
    total_amount: number;
    weighted_amount: number;
  }>;
  this_month: {
    won_amount: number;
    won_count: number;
    lost_count: number;
  };
}

export interface CrmPipelineStage {
  stage: string;
  opportunities: Array<{
    ulid: string;
    name: string;
    amount: number;
    currency: string;
    probability: number;
    expected_close_date?: string;
    account?: { ulid: string; name: string };
    owner?: { ulid: string; name: string };
  }>;
  count: number;
  total_amount: number;
}

export interface CrmPipelineStageConfig {
  id?: number;
  name: string;
  slug?: string;
  display_order?: number;
  probability: number;
  is_closed: boolean;
  is_won: boolean;
}

export interface CrmPipelineConfig {
  ulid: string;
  name: string;
  is_default: boolean;
  stages: CrmPipelineStageConfig[];
  created_at?: string;
  updated_at?: string;
}

export interface CrmVelocityResponse {
  avg_cycle_days: number;
  won_count: number;
  by_stage: Array<{
    stage: string;
    avg_days: number;
  }>;
}

// ============================================================================
// Dashboard
// ============================================================================

export interface CrmDashboardOpportunity {
  ulid: string;
  name: string;
  amount: number;
  currency: string;
  expected_close_date?: string;
  original_close_date?: string;
  slippage_days?: number;
  days_in_stage: number;
  days_since_activity?: number;
  stage_entered_at?: string;
  stage_changed_by?: { ulid: string; name: string };
  account?: { ulid: string; name: string };
  primary_contact?: { ulid: string; full_name: string };
  owner?: { ulid: string; name: string; avatar?: string };
  last_activity?: string;
  notes?: Array<{ subject?: string; occurred_at: string }>;
}

export interface CrmDashboardStage {
  stage: {
    id: number;
    name: string;
    slug: string;
    probability?: number;
    is_closed?: boolean;
    is_won?: boolean;
  };
  opportunities: CrmDashboardOpportunity[];
  count: number;
  total_amount: number;
}

export interface CrmDashboardResponse {
  stages: CrmDashboardStage[];
  metrics: {
    total_pipeline: number;
    deals_per_stage: Record<string, number>;
    avg_days_in_stage: number;
    win_rate: number;
  };
  pipeline?: { ulid: string; name: string } | null;
}

// ============================================================================
// Activities & Tasks
// ============================================================================

export interface CrmActivityComment {
  id: string;
  user_id: number;
  user_name: string;
  text: string;
  created_at: string;
}

export interface CrmActivityMetadata {
  recurrence?: "daily" | "weekly" | "monthly";
  recurrence_generated?: boolean;
  comments?: CrmActivityComment[];
}

export interface CrmActivity {
  id: number;
  type: string;
  subject?: string;
  body?: string;
  body_json?: string;
  occurred_at: string;
  completed_at?: string;
  due_at?: string;
  remind_at?: string;
  priority?: "low" | "medium" | "high";
  assigned_to?: { ulid: string; name: string };
  source?: string;
  owner?: { ulid: string; name: string };
  metadata?: CrmActivityMetadata | null;
}

export interface CrmTask {
  id: number;
  type: string;
  subject: string;
  body?: string;
  due_at?: string;
  remind_at?: string;
  priority?: "low" | "medium" | "high";
  is_overdue: boolean;
  completed_at?: string;
  occurred_at?: string;
  owner?: { ulid: string; name: string };
  assigned_to?: { ulid: string; name: string };
  entity_type: string;
  entity_ulid?: string;
  entity_name: string;
  metadata?: CrmActivityMetadata | null;
}

export interface CrmTasksResponse {
  data: CrmTask[];
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
}

export interface CrmReminder {
  id: number;
  type: string;
  subject: string;
  body?: string | null;
  due_at: string;
  is_overdue: boolean;
  priority?: "low" | "medium" | "high";
  assigned_to?: { ulid: string; name: string } | null;
  entity_type: string;
  entity_ulid: string | null;
  entity_name: string;
}

// ============================================================================
// Custom Fields
// ============================================================================

export interface CrmCustomFieldDefinition {
  id: number;
  entity_type: string;
  name: string;
  api_name: string;
  type: string;
  options?: unknown;
  sort_order: number;
}

// ============================================================================
// Reports
// ============================================================================

export interface CrmReportPipelineStageItem {
  stage: string;
  count: number;
  value: number;
  weighted: number;
}

export interface CrmReportConversionFunnel {
  leads_created: number;
  leads_qualified: number;
  leads_converted: number;
  opportunities_won: number;
  opportunities_lost: number;
  lead_to_opportunity_rate: number;
  win_rate: number;
}

export interface CrmReportActivityByType {
  type: string;
  count: number;
}

export interface CrmReportActivityWeek {
  week: string;
  count: number;
}

export interface CrmReportRevenueMonth {
  month: string;
  won_amount: number;
  won_count: number;
  lost_count: number;
}

export interface CrmReportEmailWeek {
  week: string;
  sent: number;
  opened: number;
  clicked: number;
}

export interface CrmReportEmailTemplate {
  name: string;
  sent: number;
  opened: number;
  clicked: number;
}

export interface CrmReportEmailAnalytics {
  total_sent: number;
  total_opened: number;
  total_clicked: number;
  open_rate: number;
  click_rate: number;
  by_week: CrmReportEmailWeek[];
  top_templates: CrmReportEmailTemplate[];
}

export interface CrmReportResponse {
  entity_counts: {
    contacts: number;
    accounts: number;
    leads: number;
    opportunities: number;
    activities: number;
  };
  pipeline: {
    total_value: number;
    weighted_value: number;
    open_count: number;
    avg_deal_size: number;
    by_stage: CrmReportPipelineStageItem[];
  };
  conversion_funnel: CrmReportConversionFunnel;
  activity_metrics: {
    total: number;
    by_type: CrmReportActivityByType[];
    by_week: CrmReportActivityWeek[];
  };
  revenue_over_time: CrmReportRevenueMonth[];
  overdue_snapshot: {
    overdue_tasks: number;
    tasks_due_today: number;
    stale_deals: number;
    stale_deal_threshold_days: number;
  };
  email_analytics: CrmReportEmailAnalytics;
}

// ============================================================================
// Search
// ============================================================================

export interface CrmSearchResult {
  entity_type: "contact" | "account" | "lead" | "opportunity";
  ulid: string;
  name: string;
  subtitle?: string | null;
  extra?: string | null;
}

// ============================================================================
// Automation Rules
// ============================================================================

export interface CrmAutomationCondition {
  field: string;
  operator:
    | "equals"
    | "not_equals"
    | "contains"
    | "greater_than"
    | "less_than"
    | "in"
    | "is_empty"
    | "is_not_empty";
  value: string | number | string[];
}

export interface CrmAutomationAction {
  type:
    | "create_task"
    | "send_notification"
    | "change_stage"
    | "change_lead_status"
    | "assign_owner"
    | "create_note"
    | "send_email";
  params: Record<string, unknown>;
}

export interface CrmAutomationRule {
  ulid: string;
  name: string;
  description?: string;
  is_active: boolean;
  trigger_event: string;
  conditions: CrmAutomationCondition[];
  actions: CrmAutomationAction[];
  last_triggered_at?: string;
  trigger_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface CrmAutomationLog {
  id: number;
  entity_type: string;
  entity_id: number;
  trigger_event: string;
  actions_executed: Array<{
    type: string;
    success: boolean;
    error?: string;
    details?: Record<string, unknown>;
  }>;
  created_at: string;
}

export interface CrmAutomationMeta {
  triggers: Array<{ value: string; label: string }>;
  action_types: Array<{ value: string; label: string }>;
}

// ============================================================================
// Lead Scoring
// ============================================================================

export interface CrmLeadScoringRule {
  ulid: string;
  name: string;
  description?: string;
  is_active: boolean;
  category: "engagement" | "demographic" | "activity" | "decay";
  event_trigger?: string;
  conditions: CrmAutomationCondition[];
  points: number;
  max_points_per_lead?: number;
  cooldown_hours?: number;
  created_at?: string;
  updated_at?: string;
}

export interface CrmLeadScoreLog {
  id: number;
  rule_id?: number;
  points_awarded: number;
  score_before: number;
  score_after: number;
  tier_before?: string;
  tier_after?: string;
  reason: string;
  source_entity_type?: string;
  source_entity_id?: number;
  created_at: string;
}

export interface CrmScoringMeta {
  categories: Array<{ value: string; label: string }>;
  event_triggers: Array<{ value: string; label: string }>;
}

// ============================================================================
// Email Templates & Tracking
// ============================================================================

export interface CrmEmailTemplate {
  ulid: string;
  name: string;
  subject: string;
  body_json: string;
  category?: string;
  is_shared: boolean;
  created_by_id: number;
  created_at?: string;
  updated_at?: string;
}

export interface CrmEmailLinkClick {
  id: number;
  email_send_id: number;
  original_url: string;
  clicked_at: string;
  ip_address?: string;
  user_agent?: string;
}

export interface CrmEmailSend {
  ulid: string;
  sender_id: number;
  template_id?: number;
  entity_type: string;
  entity_id: number;
  to_email: string;
  to_name?: string;
  subject: string;
  body_json?: string;
  body_html: string;
  tracking_id: string;
  sent_at?: string;
  opened_at?: string;
  open_count: number;
  clicked_at?: string;
  click_count: number;
  created_at?: string;
  sender?: { id: number; name: string; username: string };
  template?: { id: number; name: string };
  link_clicks?: CrmEmailLinkClick[];
}

export interface CrmEmailTemplateMeta {
  categories: Array<{ value: string; label: string }>;
  merge_fields: Array<{ field: string; label: string; description: string }>;
}

// ============================================================================
// Timeline
// ============================================================================

export interface CrmTimelineEntry {
  timeline_type: "activity" | "email" | "score_change";
  timestamp: string;
  data: Record<string, unknown>;
}

// ============================================================================
// Attachments
// ============================================================================

export interface CrmAttachment {
  ulid: string;
  filename: string;
  mime_type: string;
  size: number;
  uploaded_by: { name: string } | null;
  created_at: string;
}

// ============================================================================
// Audit Log
// ============================================================================

export interface CrmAuditLogEntry {
  id: number;
  action: string;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  user: { ulid: string; name: string } | null;
  created_at: string;
}

export interface CrmAuditLogResponse {
  data: CrmAuditLogEntry[];
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
}

// ============================================================================
// Duplicate Detection
// ============================================================================

export interface CrmDuplicateMatch {
  ulid: string;
  full_name: string;
  match_type: "email" | "phone" | "name" | "name_company";
  entity_type: "contact" | "lead";
  company?: string;
}

export interface CrmDuplicateCheckResult {
  contacts: CrmDuplicateMatch[];
  leads: CrmDuplicateMatch[];
}

// ============================================================================
// Saved Views
// ============================================================================

export interface CrmSavedViewFilter {
  field: string;
  operator: string;
  value: string;
}

export interface CrmSavedView {
  id: number;
  ulid: string;
  entity_type: string;
  name: string;
  filters: CrmSavedViewFilter[];
  sort: { field: string; direction: "asc" | "desc" } | null;
  is_default: boolean;
  is_shared: boolean;
  user_id: number;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Import
// ============================================================================

export interface ContactImportResult {
  imported: number;
  skipped: number;
  errors: Record<number, string>;
}

// ============================================================================
// Drip Campaigns
// ============================================================================

export interface DripCampaignStep {
  id: number;
  drip_campaign_id: number;
  step_order: number;
  delay_days: number;
  subject: string;
  body_json: string;
  created_at: string;
  updated_at: string;
}

export interface DripCampaign {
  id: number;
  tenant_id: number;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  steps?: DripCampaignStep[];
  steps_count?: number;
  enrollments_count?: number;
}

export interface DripCampaignEnrollment {
  id: number;
  drip_campaign_id: number;
  user_id: number;
  enrolled_at: string;
  last_sent_step_id: number | null;
  completed_at: string | null;
  user?: { id: number; ulid: string; name: string; username: string; email: string };
}

export interface DripPaginatedResponse<T> {
  data: T[];
  meta: { current_page: number; last_page: number; per_page: number; total: number };
  links: { first: string; last: string; prev: string | null; next: string | null };
}

export interface DripCampaignStepStat {
  step_id: number;
  step_order: number;
  sent: number;
  opened: number;
  clicked: number;
  open_rate: number;
  click_rate: number;
}

export interface DripCampaignStats {
  total_enrollments: number;
  completed_enrollments: number;
  steps: DripCampaignStepStat[];
}
