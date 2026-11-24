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

export type Project = {
  schema_version: number;
  name: string;
  engine: Engine;
  created_at: string;
  updated_at: string;
};

export type ProjectResponse = {
  project: Project;
  path: string;
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
  default: boolean;
};

export type ProvidersResponse = {
  providers: ProviderInfo[];
  default_provider: string;
};

export type AiRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

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

export type BlenderSkill = {
  name: string;
  description: string;
  path: string;
  group: string;
  group_label: string;
  scripts: string[];
  files: string[];
};

export type BlenderSkillDetail = BlenderSkill & {
  content: string;
};

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
