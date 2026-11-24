export const SECTIONS = [
  "Обзор",
  "Проекты",
  "Задачи",
  "Review",
  "Ассеты",
  "Скиллы",
  "Снапшоты",
  "Память",
  "Пакеты",
  "Агенты",
  "Doctor",
  "Редактор",
] as const;

export type Section = (typeof SECTIONS)[number] | "Настройки";

export type CoreStatus = "checking" | "ok" | "offline";

export type Engine =
  | "generic"
  | "blender"
  | "roblox"
  | "godot"
  | "unity"
  | "unreal"
  | "rpgmaker"
  | "web";

export type TaskStatus =
  | "draft"
  | "ready"
  | "working"
  | "checking"
  | "review"
  | "done"
  | "blocked"
  | "archived";

export type TaskType =
  | "model"
  | "animation"
  | "effect"
  | "texture"
  | "code"
  | "level"
  | "export";

export type AgentMode = "clipboard" | "cli" | "api" | "local" | "mcp";

export type IsolationMode = "direct" | "worktree";

export type RoutingRule = { id: string; tag: string; provider_id: string };

export type AgentRole = {
  id: string;
  name: string;
  prompt: string;
  provider_id: string;
};

export type ProviderCatalogItem = {
  id: string;
  name: string;
  style: string;
  api_url: string;
  description: string;
  brand: string;
  available: boolean;
  connected: boolean;
  configured: boolean;
  provider_id: string;
  models_count: number;
};

export type AgentRouting = { rules: RoutingRule[]; roles: AgentRole[] };

export type AgentRecommendation = {
  provider_id: string;
  provider_name: string;
  reason: string;
};

export type AgentUsage = {
  budget: number;
  used: number;
  known_runs: number;
  unknown_runs: number;
  remaining: number | null;
  exhausted: boolean;
};

export type Project = {
  schema_version: number;
  name: string;
  engine: Engine;
  max_parallel_runs: number;
  isolation: IsolationMode;
  token_budget: number;
  created_at: string;
  updated_at: string;
};

export type ProjectResponse = {
  project: Project;
  path: string;
  git_repo: boolean;
};

export type ProjectCard = {
  id: string;
  name: string;
  engine: Engine;
  path: string;
  cover_url: string;
  active: boolean;
  exists: boolean;
  created_at: string;
  last_opened_at: string;
  updated_at: string;
  tasks_total: number;
  tasks_active: number;
  tasks_done: number;
  assets_total: number;
};

export type ProjectsResponse = {
  projects: ProjectCard[];
  default_parent: string;
};

export type CreateProjectInput = {
  name: string;
  engine: Engine;
  parent?: string;
};

export type DuplicateProjectInput = {
  name: string;
  parent?: string;
};

export type Criterion = {
  id: string;
  text: string;
  done: boolean;
  check_id: string | null;
};

export type ArtifactRef = {
  id: string;
  kind: string;
  path: string;
  created_at: string;
};

export type ValidationMode = "ask" | "always" | "never";

export type WorkflowStepStatus = "pending" | "active" | "done" | "failed" | "skipped";

export type WorkflowStep = {
  id: string;
  title: string;
  prompt: string;
  status: WorkflowStepStatus;
  run_id: string;
};

export type ValidationCommand = {
  id: string;
  label: string;
  command: string;
  timeout: number;
  created_at: string;
};

export type ValidationSuggestion = {
  label: string;
  command: string;
  source: string;
};

export type ValidationResult = {
  id: string;
  task_id: string;
  command_id: string;
  label: string;
  command: string;
  status: "passed" | "failed" | "timeout" | "error";
  exit_code: number | null;
  duration_ms: number;
  output: string;
  error: string;
  log_path: string;
  created_at: string;
  agent_run_id: string;
  agent_session_id: string;
  agent_run_status: string;
};

export type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  type: TaskType;
  engine: Engine;
  goal: string;
  criteria: Criterion[];
  constraints: string[];
  assigned_agent: string | null;
  mode: AgentMode;
  skills: string[];
  validation: ValidationCommand[];
  validation_mode: ValidationMode;
  role_id: string;
  workflow: WorkflowStep[];
  asset_ids: string[];
  created_at: string;
  updated_at: string;
  next_step: string;
  tags: string[];
  artifacts: ArtifactRef[];
  deleted_at: string | null;
};

export type CreateTaskInput = {
  title: string;
  type: TaskType;
  engine: Engine;
  goal: string;
  criteria: string[];
  asset_ids?: string[];
};

export type UpdateTaskInput = {
  title?: string;
  status?: TaskStatus;
  goal?: string;
  next_step?: string;
  criteria?: string[];
  skills?: string[];
  validation_mode?: ValidationMode;
  role_id?: string;
};

export type AssetVersionStatus = "draft" | "review" | "accepted" | "archived";

export type AssetVersion = {
  id: string;
  label: string;
  status: AssetVersionStatus;
  reason: string;
  path: string;
  file_hash: string;
  file_size: number;
  preview: string;
  metrics: AssetMetrics | null;
  created_at: string;
};

export type AssetMetrics = {
  triangles: number | null;
  vertices: number | null;
  materials: number | null;
  textures: number | null;
  bones: number | null;
  animations: number | null;
};

export type AssetPassport = {
  id: string;
  name: string;
  type: string;
  engine: Engine;
  path: string;
  file_hash: string;
  file_size: number;
  preview: string;
  current_version_id: string | null;
  origin: string;
  task_id: string | null;
  task_ids: string[];
  description: string;
  agent: string | null;
  license: string;
  metrics: AssetMetrics;
  versions: AssetVersion[];
  checks: string[];
  created_at: string;
  updated_at: string;
};

export type ProviderCapabilities = {
  checked: boolean;
  checked_at: string;
  source: string;
  version: string;
  supports_model: boolean;
  supports_resume: boolean;
  supports_json: boolean;
  supports_permissions: boolean;
  supports_non_interactive: boolean;
  flags: string[];
  note: string;
};

export type ProviderInfo = {
  id: string;
  name: string;
  kind: string;
  command: string;
  args: string[];
  enabled: boolean;
  installed: boolean;
  path: string;
  version: string;
  builtin: boolean;
  description: string;
  url: string;
  timeout: number;
  models: string[];
  default_model: string;
  models_args: string[];
  read_only_args: string[];
  resume_args: string[];
  api_url: string;
  api_model: string;
  api_style: "openai" | "anthropic" | "google" | "azure" | "vertex" | "bedrock";
  api_max_tokens: number;
  catalog_id: string;
  gcp_project: string;
  gcp_region: string;
  aws_region: string;
  has_key: boolean;
  local_api: boolean;
  session_regex: string;
  output_mode: string;
  capabilities: ProviderCapabilities;
  default: boolean;
};

export type ProvidersResponse = {
  providers: ProviderInfo[];
  default_provider: string;
};

export type AiRunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

export type ToolApproval = {
  id: string;
  tool: string;
  args: {
    tool: string;
    path?: string;
    command?: string;
    bytes?: number;
    preview?: string;
  };
  status: "pending" | "allowed" | "denied" | "allowed_all" | "timeout";
  created_at: string;
};

export type AgentAction = {
  kind: "command" | "file" | string;
  value: string;
  exit_code?: number | null;
  change?: string;
};

export type AiRun = {
  id: string;
  task_id: string;
  task_title: string;
  session_id: string;
  provider_id: string;
  provider_name: string;
  status: AiRunStatus;
  created_at: string;
  started_at: string;
  finished_at: string;
  exit_code: number | null;
  output: string;
  error: string;
  log_path: string;
  artifact_path: string;
  review_id: string;
  snapshot_id: string;
  snapshot_error: string;
  command: string;
  args: string[];
  cancel_requested: boolean;
  pid: number | null;
  interrupted_reason: string;
  model: string;
  handoff_id: string;
  changes: Array<{
    path: string;
    status: "added" | "modified" | "deleted";
    size: number;
    previous_size: number;
    patch_path: string;
    binary: boolean;
    patch_truncated: boolean;
    additions: number;
    deletions: number;
  }>;
  changes_total: number;
  changes_truncated: boolean;
  changes_error: string;
  queue_position: number;
  max_parallel_runs: number;
  isolation: "direct" | "worktree";
  worktree_path: string;
  worktree_applied_at: string;
  worktree_applied: number;
  worktree_deleted: number;
  read_only: boolean;
  resumed: boolean;
  resumed_from_session: string;
  resumed_from_run: string;
  workflow_step_id: string;
  role_id: string;
  role_name: string;
  tool_policy: string;
  approval: ToolApproval | null;
  auto_approve: boolean;
  cli_session_id: string;
  usage: Record<string, unknown> | null;
  actions: AgentAction[];
};

export type AgentSession = {
  id: string;
  task_id: string;
  task_title: string;
  provider_id: string;
  provider_name: string;
  status: "active" | "completed" | "failed" | "cancelled" | "interrupted";
  created_at: string;
  updated_at: string;
  finished_at: string;
  snapshot_before: string;
  handoff_id: string;
  cli_session_id: string;
  run_ids: string[];
  runs: AiRun[];
};

export type BlenderScene = {
  name: string;
  object_count: number;
  file: string;
};

export type BlenderStatus = {
  installed: boolean;
  path: string;
  version: string;
  addon_installed: boolean;
  addon_version: string;
  addon_path: string;
  connected: boolean;
  host: string;
  port: number | null;
  scene: BlenderScene | null;
  workspace: string;
  message: string;
};

export type BlenderWorkspace = {
  exists: boolean;
  root: string;
  path: string;
  models: string[];
  scripts: { name: string; script: string; updated_at: string }[];
  checks: string[];
};

export type SkillCategory =
  | "blender"
  | "code"
  | "roblox"
  | "unity"
  | "godot"
  | "unreal"
  | "general";

export type Skill = {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  category_label: string;
  group: string;
  group_label: string;
  path: string;
  source: "builtin" | "user";
  locked: boolean;
  scripts: string[];
  files: string[];
  updated_at?: string;
};

export type SkillDetail = Skill & {
  content: string;
};

export type BlenderSkill = Skill;
export type BlenderSkillDetail = SkillDetail;

export type BlenderInspectResult = {
  asset: AssetPassport;
  checks: CheckResult[];
};

export type ImportAssetInput = {
  path: string;
  name?: string;
  engine?: Engine;
  license?: string;
  task_id?: string;
};

export type ProjectStats = {
  assets_total: number;
  assets_review: number;
  assets_accepted: number;
  assets_problems: number;
  tasks_total: number;
  tasks_active: number;
  tasks_review: number;
  tasks_done: number;
};

export type Capsule = {
  id: string;
  task_id: string;
  project_context: string;
  engine: Engine;
  rules: string[];
  done: string[];
  problems: string[];
  files: string[];
  constraints: string[];
  next_step: string[];
  output_format: string;
  forbidden: string[];
  references: string[];
  created_at: string;
};

export type CapsuleResponse = {
  capsule: Capsule;
  text: string;
};

export type ReviewStatus = "pending" | "accepted" | "rework" | "archived";

export type ReviewItem = {
  id: string;
  task_id: string;
  asset_id: string | null;
  status: ReviewStatus;
  summary: string;
  artifact_path: string | null;
  created_at: string;
  updated_at: string;
};

export type ImportResponseResult = {
  task: Task;
  review: ReviewItem;
  artifact_path: string;
};

export type LedgerEvent = {
  id: string;
  type: string;
  at: string;
  actor: string;
  subject: string;
  data: Record<string, unknown>;
};

export type SnapshotFile = {
  path: string;
  hash: string;
  size: number;
};

export type Snapshot = {
  id: string;
  reason: string;
  scope: string;
  created_at: string;
  created_by: string;
  files: SnapshotFile[];
  restore_point: boolean;
  label: string;
};

export type CheckStatus =
  | "pending"
  | "passed"
  | "failed"
  | "warning"
  | "skipped"
  | "error";

export type CheckResult = {
  id: string;
  name: string;
  status: CheckStatus;
  message: string;
  details: Record<string, unknown>;
  created_at: string;
};
