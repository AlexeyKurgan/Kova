import type {
  AiRun,
  AgentSession,
  AssetPassport,
  BlenderInspectResult,
  ChatSession,
  ChatSummary,
  ModelCatalogGroup,
  BlenderStatus,
  BlenderWorkspace,
  CapsuleResponse,
  CheckResult,
  CreateProjectInput,
  CreateTaskInput,
  DuplicateProjectInput,
  Engine,
  ImportAssetInput,
  ImportResponseResult,
  LedgerEvent,
  ProjectCard,
  ProjectResponse,
  ProjectsResponse,
  ProjectStats,
  TrashProject,
  TrashProjectsResponse,
  ProviderInfo,
  ProvidersResponse,
  ReviewItem,
  RobloxStatus,
  Skill,
  SkillDetail,
  Snapshot,
  Task,
  UpdateTaskInput,
  ValidationResult,
  ValidationSuggestion,
} from "./types";

export const CORE_URL = import.meta.env.VITE_CORE_URL ?? "http://127.0.0.1:8765";
let TOKEN = import.meta.env.VITE_CORE_TOKEN ?? "";
let tokenPromise: Promise<void> | null = null;

export type HealthResponse = {
  status: string;
  version: string;
};

async function ensureToken(): Promise<void> {
  if (TOKEN) return;
  if (!tokenPromise) {
    tokenPromise = (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const value = await invoke<string>("core_token");
        if (value) TOKEN = value;
      } catch {
        // Browser/dev mode: the core may run without an owner token.
      }
    })();
  }
  await tokenPromise;
}

function withAuth(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  if (TOKEN) result.set("X-Kova-Token", TOKEN);
  return result;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  await ensureToken();
  const headers = withAuth(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${CORE_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    let detail = `${init.method ?? "GET"} ${path}: ${response.status}`;
    try {
      const data = (await response.json()) as { detail?: unknown };
      if (typeof data.detail === "string") detail = data.detail;
    } catch {
      detail = `${init.method ?? "GET"} ${path}: ${response.status}`;
    }
    throw new Error(detail);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function coreHealth(): Promise<HealthResponse> {
  await ensureToken();
  const response = await fetch(`${CORE_URL}/health`, { headers: withAuth() });
  if (!response.ok) {
    throw new Error(`Core health check failed: ${response.status}`);
  }
  return response.json() as Promise<HealthResponse>;
}

export async function listProjectTrash(): Promise<TrashProjectsResponse> {
  return request<TrashProjectsResponse>("/projects/trash");
}

export async function cleanupProjectTrash(days = 30): Promise<{ removed: number }> {
  return request<{ removed: number }>(`/projects/trash/cleanup?days=${days}`, {
    method: "POST",
  });
}

export async function restoreProjectTrash(trashId: string): Promise<TrashProject> {
  return request<TrashProject>(`/projects/trash/${encodeURIComponent(trashId)}/restore`, {
    method: "POST",
  });
}

export async function purgeProjectTrash(trashId: string): Promise<void> {
  await request<void>(`/projects/trash/${encodeURIComponent(trashId)}`, {
    method: "DELETE",
  });
}

export async function getRobloxStatus(): Promise<RobloxStatus> {
  return request<RobloxStatus>("/roblox/status");
}

export async function installRobloxPlugin(): Promise<{
  ok: boolean;
  path: string;
  version: string;
  message: string;
}> {
  return request("/roblox/install-plugin", { method: "POST" });
}

export async function buildRobloxPlace(
  projectPath: string,
  launch = false,
): Promise<{
  ok: boolean;
  path: string;
  asset_id: string;
  bytes: number;
  launch?: { ok: boolean; pid: number; studio: string; place: string };
}> {
  return request("/roblox/build-place", {
    method: "POST",
    body: JSON.stringify({ project_path: projectPath, launch }),
  });
}

export async function launchRobloxStudio(
  placePath?: string,
): Promise<{ ok: boolean; pid: number; studio: string; place: string }> {
  return request("/roblox/launch", {
    method: "POST",
    body: JSON.stringify({ place_path: placePath ?? null }),
  });
}

export async function executeRobloxCommand(
  command: Record<string, unknown>,
): Promise<{ ok: boolean; id: string; command: Record<string, unknown> }> {
  return request("/roblox/execute", {
    method: "POST",
    body: JSON.stringify({ command }),
  });
}

export async function getProject(): Promise<ProjectResponse | null> {
  await ensureToken();
  const response = await fetch(`${CORE_URL}/project`, { headers: withAuth() });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GET /project: ${response.status}`);
  }
  return response.json() as Promise<ProjectResponse>;
}

export async function updateProject(input: {
  max_parallel_runs?: number;
  isolation?: "direct" | "worktree" | "sandbox";
  token_budget?: number;
  local_only?: boolean;
  egress_guard?: boolean;
  remote_consents?: string[];
}): Promise<ProjectResponse> {
  return request<ProjectResponse>("/project", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function openProject(
  path: string,
  name?: string,
  engine?: Engine,
): Promise<ProjectResponse> {
  return request<ProjectResponse>("/project/open", {
    method: "POST",
    body: JSON.stringify({ path, name, engine }),
  });
}

export async function openDemoProject(): Promise<ProjectResponse> {
  return request<ProjectResponse>("/project/demo", { method: "POST" });
}

export async function listProjects(): Promise<ProjectsResponse> {
  return request<ProjectsResponse>("/projects");
}

export async function createProject(input: CreateProjectInput): Promise<ProjectCard> {
  return request<ProjectCard>("/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function openProjectCard(projectId: string): Promise<ProjectCard> {
  return request<ProjectCard>(`/projects/${encodeURIComponent(projectId)}/open`, {
    method: "POST",
  });
}

export async function updateProjectCard(
  projectId: string,
  input: { name?: string; engine?: Engine },
): Promise<ProjectCard> {
  return request<ProjectCard>(`/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteProjectCard(
  projectId: string,
  deleteFiles: boolean,
): Promise<void> {
  return request<void>(
    `/projects/${encodeURIComponent(projectId)}?delete_files=${deleteFiles ? "true" : "false"}`,
    { method: "DELETE" },
  );
}

export async function duplicateProjectCard(
  projectId: string,
  input: DuplicateProjectInput,
): Promise<ProjectCard> {
  return request<ProjectCard>(
    `/projects/${encodeURIComponent(projectId)}/duplicate`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function setProjectCover(
  projectId: string,
  path: string,
): Promise<ProjectCard> {
  return request<ProjectCard>(`/projects/${encodeURIComponent(projectId)}/cover`, {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export async function listTasks(): Promise<Task[]> {
  return request<Task[]>("/tasks");
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  return request<Task>("/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function addWorkflowStep(
  taskId: string,
  input: { title: string; prompt?: string },
): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(taskId)}/workflow`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateWorkflowStep(
  taskId: string,
  stepId: string,
  input: { title?: string; prompt?: string; status?: string },
): Promise<Task> {
  return request<Task>(
    `/tasks/${encodeURIComponent(taskId)}/workflow/${encodeURIComponent(stepId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export async function deleteWorkflowStep(taskId: string, stepId: string): Promise<Task> {
  return request<Task>(
    `/tasks/${encodeURIComponent(taskId)}/workflow/${encodeURIComponent(stepId)}`,
    { method: "DELETE" },
  );
}

export async function updateTask(
  taskId: string,
  input: UpdateTaskInput,
): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteTask(taskId: string): Promise<void> {
  return request<void>(`/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
}

export async function listTrashTasks(): Promise<Task[]> {
  return request<Task[]>("/tasks/trash");
}

export async function restoreTask(taskId: string): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(taskId)}/restore`, {
    method: "POST",
  });
}

export async function purgeTask(taskId: string): Promise<void> {
  return request<void>(`/tasks/${encodeURIComponent(taskId)}/purge`, {
    method: "DELETE",
  });
}

export async function listAssets(): Promise<AssetPassport[]> {
  return request<AssetPassport[]>("/assets");
}

export async function getStats(): Promise<ProjectStats> {
  return request<ProjectStats>("/stats");
}

export function coreUrl(path: string): string {
  return `${CORE_URL}${path}`;
}

export async function getBlenderStatus(): Promise<BlenderStatus> {
  return request<BlenderStatus>("/blender/status");
}

export async function setupBlender(): Promise<BlenderStatus> {
  return request<BlenderStatus>("/blender/setup", { method: "POST" });
}

export async function connectBlender(): Promise<BlenderStatus> {
  return request<BlenderStatus>("/blender/connect", { method: "POST" });
}

export async function getBlenderWorkspace(): Promise<BlenderWorkspace> {
  return request<BlenderWorkspace>("/blender/workspace");
}

export async function ensureBlenderWorkspace(): Promise<BlenderWorkspace> {
  return request<BlenderWorkspace>("/blender/workspace", { method: "POST" });
}

export async function listChats(): Promise<ChatSummary[]> {
  return request<ChatSummary[]>("/chats");
}

export async function getChat(chatId: string): Promise<ChatSession> {
  return request<ChatSession>(`/chats/${encodeURIComponent(chatId)}`);
}

export async function createChat(input: {
  title?: string;
  scope?: "project" | "task";
  task_id?: string;
  task_ids?: string[];
  provider_id?: string;
  model?: string;
  effort?: string;
}): Promise<ChatSession> {
  return request<ChatSession>("/chats", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateChat(
  chatId: string,
  input: {
    title?: string;
    provider_id?: string;
    model?: string;
    scope?: "project" | "task";
    task_id?: string;
    task_ids?: string[];
    effort?: string;
    external_paths?: string[];
  },
): Promise<ChatSession> {
  return request<ChatSession>(`/chats/${encodeURIComponent(chatId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteChat(chatId: string): Promise<void> {
  await request<void>(`/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" });
}

export type ChatAttachmentInput = {
  name: string;
  mime: string;
  data: string;
};

export async function sendChatMessage(
  chatId: string,
  text: string,
  attachments: ChatAttachmentInput[] = [],
): Promise<ChatSession> {
  return request<ChatSession>(`/chats/${encodeURIComponent(chatId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ text, attachments }),
  });
}

export async function getModelCatalog(providerId: string): Promise<ModelCatalogGroup[]> {
  const data = await request<{ groups: ModelCatalogGroup[] }>(
    `/providers/${encodeURIComponent(providerId)}/catalog`,
  );
  return data.groups ?? [];
}

export function chatAttachmentUrl(chatId: string, attachmentId: string): string {
  return `${CORE_URL}/chats/${encodeURIComponent(chatId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

export async function cancelChat(chatId: string): Promise<ChatSession> {
  return request<ChatSession>(`/chats/${encodeURIComponent(chatId)}/cancel`, {
    method: "POST",
  });
}

export async function decideChatAction(
  chatId: string,
  actionId: string,
  decision: "approve" | "reject",
): Promise<ChatSession> {
  return request<ChatSession>(
    `/chats/${encodeURIComponent(chatId)}/actions/${encodeURIComponent(actionId)}`,
    {
      method: "POST",
      body: JSON.stringify({ decision }),
    },
  );
}

export function chatEventsUrl(chatId?: string): string {
  return chatId
    ? `${CORE_URL}/chats/${encodeURIComponent(chatId)}/events`
    : `${CORE_URL}/chats/events`;
}

export async function listSkills(): Promise<Skill[]> {
  return request<Skill[]>("/skills");
}

export async function getSkill(skillId: string): Promise<SkillDetail> {
  return request<SkillDetail>(`/skills/${encodeURIComponent(skillId)}`);
}

export async function createSkill(input: {
  name: string;
  description?: string;
  category?: string;
  content?: string;
  locked?: boolean;
}): Promise<SkillDetail> {
  return request<SkillDetail>("/skills", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateSkill(
  skillId: string,
  input: {
    name?: string;
    description?: string;
    category?: string;
    content?: string;
    locked?: boolean;
  },
  unlock = false,
): Promise<SkillDetail> {
  return request<SkillDetail>(
    `/skills/${encodeURIComponent(skillId)}${unlock ? "?unlock=true" : ""}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export async function deleteSkill(skillId: string, unlock = false): Promise<void> {
  await request<void>(
    `/skills/${encodeURIComponent(skillId)}${unlock ? "?unlock=true" : ""}`,
    { method: "DELETE" },
  );
}

export async function listBlenderSkills(): Promise<Skill[]> {
  return listSkills();
}

export async function getBlenderSkill(name: string): Promise<SkillDetail> {
  return getSkill(name);
}

export async function captureBlenderScreenshot(): Promise<string> {
  await request<{ path: string }>("/blender/screenshot", { method: "POST" });
  return `${CORE_URL}/blender/screenshot?v=${Date.now()}`;
}

export async function inspectAssetWithBlender(
  assetId: string,
): Promise<BlenderInspectResult> {
  return request<BlenderInspectResult>(
    `/assets/${encodeURIComponent(assetId)}/blender`,
    { method: "POST" },
  );
}

export async function importAsset(input: ImportAssetInput): Promise<AssetPassport> {
  return request<AssetPassport>("/assets/import", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateAsset(
  assetId: string,
  input: { task_ids?: string[]; task_id?: string | null; description?: string },
): Promise<AssetPassport> {
  return request<AssetPassport>(`/assets/${encodeURIComponent(assetId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function getAsset(assetId: string): Promise<AssetPassport> {
  return request<AssetPassport>(`/assets/${encodeURIComponent(assetId)}`);
}

export async function addValidationCommand(
  taskId: string,
  input: { label: string; command: string; timeout?: number },
): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(taskId)}/validation`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteValidationCommand(
  taskId: string,
  commandId: string,
): Promise<Task> {
  return request<Task>(
    `/tasks/${encodeURIComponent(taskId)}/validation/${encodeURIComponent(commandId)}`,
    { method: "DELETE" },
  );
}

export async function getValidationSuggestions(
  taskId: string,
): Promise<ValidationSuggestion[]> {
  return request<ValidationSuggestion[]>(
    `/tasks/${encodeURIComponent(taskId)}/validation/suggestions`,
  );
}

export async function listValidationResults(taskId: string): Promise<ValidationResult[]> {
  return request<ValidationResult[]>(
    `/tasks/${encodeURIComponent(taskId)}/validation/results`,
  );
}

export async function runTaskValidation(
  taskId: string,
  commandId?: string,
  runId?: string,
): Promise<ValidationResult[]> {
  return request<ValidationResult[]>(
    `/tasks/${encodeURIComponent(taskId)}/validation/run`,
    {
      method: "POST",
      body: JSON.stringify({
        ...(commandId ? { command_id: commandId } : {}),
        ...(runId ? { run_id: runId } : {}),
      }),
    },
  );
}

export async function getAssetChecks(
  assetId: string,
  versionId?: string,
): Promise<CheckResult[]> {
  const query = versionId ? `?version_id=${encodeURIComponent(versionId)}` : "";
  return request<CheckResult[]>(
    `/assets/${encodeURIComponent(assetId)}/checks${query}`,
  );
}

export async function runAssetChecks(assetId: string): Promise<CheckResult[]> {
  return request<CheckResult[]>(
    `/assets/${encodeURIComponent(assetId)}/checks`,
    { method: "POST" },
  );
}

export async function prepareCapsule(taskId: string): Promise<CapsuleResponse> {
  return request<CapsuleResponse>(`/tasks/${encodeURIComponent(taskId)}/capsule`, {
    method: "POST",
  });
}

export async function importResponse(
  taskId: string,
  text: string,
): Promise<ImportResponseResult> {
  return request<ImportResponseResult>(`/tasks/${encodeURIComponent(taskId)}/response`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function listReview(): Promise<ReviewItem[]> {
  return request<ReviewItem[]>("/review");
}

export async function reviewResponse(reviewId: string): Promise<string> {
  const result = await request<{ text: string }>(
    `/review/${encodeURIComponent(reviewId)}/response`,
  );
  return result.text;
}

export async function acceptReview(reviewId: string): Promise<ReviewItem> {
  return request<ReviewItem>(`/review/${encodeURIComponent(reviewId)}/accept`, {
    method: "POST",
  });
}

export async function reworkReview(reviewId: string): Promise<ReviewItem> {
  return request<ReviewItem>(`/review/${encodeURIComponent(reviewId)}/rework`, {
    method: "POST",
  });
}

export async function listLedger(limit = 30): Promise<LedgerEvent[]> {
  return request<LedgerEvent[]>(`/ledger?limit=${limit}`);
}

export async function listSnapshots(): Promise<Snapshot[]> {
  return request<Snapshot[]>("/snapshots");
}

export async function createSnapshot(reason: string): Promise<Snapshot> {
  return request<Snapshot>("/snapshots", {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function deleteSnapshot(snapshotId: string): Promise<void> {
  await request<void>(`/snapshots/${encodeURIComponent(snapshotId)}`, { method: "DELETE" });
}

export async function cleanupSnapshots(keep = 10, days = 30): Promise<{ removed: number }> {
  return request<{ removed: number }>(`/snapshots/cleanup?keep=${keep}&days=${days}`, {
    method: "POST",
  });
}

export async function restoreSnapshot(snapshotId: string): Promise<Snapshot> {
  return request<Snapshot>(`/snapshots/${encodeURIComponent(snapshotId)}/restore`, {
    method: "POST",
  });
}

export async function getDoctor(): Promise<CheckResult[]> {
  return request<CheckResult[]>("/doctor");
}

export async function listProviders(): Promise<ProvidersResponse> {
  return request<ProvidersResponse>("/providers");
}

export async function updateProvider(
  providerId: string,
  input: {
    name?: string;
    description?: string;
    command?: string;
    args?: string[];
    enabled?: boolean;
    timeout?: number;
    models?: string[];
    set_default?: boolean;
  },
): Promise<ProviderInfo> {
  return request<ProviderInfo>(`/providers/${encodeURIComponent(providerId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function createProvider(input: {
  name: string;
  command: string;
  args?: string[];
  description?: string;
  timeout?: number;
  models?: string[];
  set_default?: boolean;
}): Promise<ProviderInfo> {
  return request<ProviderInfo>("/providers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function checkProvider(providerId: string): Promise<ProviderInfo> {
  return request<ProviderInfo>(`/providers/${encodeURIComponent(providerId)}/check`, {
    method: "POST",
  });
}

export async function startAiRun(input: {
  task_id: string;
  provider?: string;
  snapshot: boolean;
  message?: string;
  model?: string;
  handoff_from_session?: string;
  read_only?: boolean;
  workflow_step_id?: string;
  role_id?: string;
  tool_policy?: "read-only" | "workspace" | "auto";
}): Promise<AiRun> {
  return request<AiRun>("/ai/runs", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function resumeAiSession(
  sessionId: string,
  input: { message?: string; model?: string; snapshot?: boolean; read_only?: boolean },
): Promise<AiRun> {
  return request<AiRun>(`/ai/sessions/${encodeURIComponent(sessionId)}/resume`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getAiRun(runId: string): Promise<AiRun> {
  return request<AiRun>(`/ai/runs/${encodeURIComponent(runId)}`);
}

export async function listRecentAiRuns(limit = 8): Promise<AiRun[]> {
  return request<AiRun[]>(`/ai/runs?limit=${limit}`);
}

export type HandoffPreview = {
  id: string;
  from_session_id: string;
  from_provider_id: string;
  from_provider_name: string;
  from_session_status: string;
  from_run_id: string;
  from_run_status: string;
  snapshot_id: string;
  to_provider_id: string;
  to_provider_name: string;
  summary: string;
  created_at: string;
  text: string;
};

export async function previewAiHandoff(input: {
  task_id: string;
  from_session_id: string;
  to_provider: string;
}): Promise<HandoffPreview> {
  return request<HandoffPreview>("/ai/handoffs/preview", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getAgentRouting(): Promise<import("./types").AgentRouting> {
  return request<import("./types").AgentRouting>("/ai/routing");
}

export async function saveAgentRouting(
  input: import("./types").AgentRouting,
): Promise<import("./types").AgentRouting> {
  return request<import("./types").AgentRouting>("/ai/routing", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function recommendProvider(
  taskId: string,
): Promise<import("./types").AgentRecommendation> {
  return request<import("./types").AgentRecommendation>(
    `/ai/routing/recommend?task_id=${encodeURIComponent(taskId)}`,
  );
}

export async function getAgentUsage(): Promise<import("./types").AgentUsage> {
  return request<import("./types").AgentUsage>("/ai/usage");
}

export async function applyWorktreeRun(runId: string): Promise<AiRun> {
  return request<AiRun>(`/ai/runs/${encodeURIComponent(runId)}/apply-worktree`, {
    method: "POST",
  });
}

export async function cleanupAgentHistory(
  keep = 50,
): Promise<{ runs_removed: number; sessions_removed: number; logs_removed: number; diffs_removed: number }> {
  return request(`/ai/cleanup`, {
    method: "POST",
    body: JSON.stringify({ keep }),
  });
}

export async function getRunChangePatch(runId: string, index: number): Promise<string> {
  await ensureToken();
  const response = await fetch(
    `${CORE_URL}/ai/runs/${encodeURIComponent(runId)}/changes/${index}`,
    { headers: withAuth() },
  );
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.text();
}

export async function listAiSessions(taskId: string, limit = 20): Promise<AgentSession[]> {
  return request<AgentSession[]>(
    `/ai/sessions?task_id=${encodeURIComponent(taskId)}&limit=${limit}`,
  );
}

export async function listAiRuns(taskId: string): Promise<AiRun[]> {
  return request<AiRun[]>(`/ai/runs?task_id=${encodeURIComponent(taskId)}`);
}

export async function approveAiRun(
  runId: string,
  decision: "allow" | "deny" | "allow_all",
): Promise<AiRun> {
  return request<AiRun>(`/ai/runs/${encodeURIComponent(runId)}/approval`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}

export async function cancelAiRun(runId: string): Promise<AiRun> {
  return request<AiRun>(`/ai/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
  });
}

export async function getProviderCatalog(): Promise<{
  providers: import("./types").ProviderCatalogItem[];
}> {
  return request<{ providers: import("./types").ProviderCatalogItem[] }>("/providers/catalog");
}

export async function discoverProviderModels(
  providerId: string,
): Promise<{ models: string[]; source: string }> {
  return request(`/providers/${encodeURIComponent(providerId)}/models`, {
    method: "POST",
  });
}

export async function deleteProvider(providerId: string): Promise<void> {
  return request<void>(`/providers/${encodeURIComponent(providerId)}`, {
    method: "DELETE",
  });
}

export async function addAssetVersion(
  assetId: string,
  path: string,
  reason: string,
  makeCurrent: boolean,
): Promise<AssetPassport> {
  return request<AssetPassport>(`/assets/${encodeURIComponent(assetId)}/versions`, {
    method: "POST",
    body: JSON.stringify({ path, reason, make_current: makeCurrent }),
  });
}

export async function activateAssetVersion(
  assetId: string,
  versionId: string,
): Promise<AssetPassport> {
  return request<AssetPassport>(
    `/assets/${encodeURIComponent(assetId)}/versions/${encodeURIComponent(versionId)}/activate`,
    { method: "POST" },
  );
}


export async function deleteAsset(assetId: string): Promise<void> {
  await request<void>(`/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
}

export async function duplicateAsset(assetId: string): Promise<AssetPassport> {
  return request<AssetPassport>(`/assets/${encodeURIComponent(assetId)}/duplicate`, {
    method: "POST",
  });
}
