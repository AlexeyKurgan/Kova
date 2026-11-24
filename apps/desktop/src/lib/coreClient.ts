import type {
  AiRun,
  AgentSession,
  AssetPassport,
  BlenderInspectResult,
  BlenderSkill,
  BlenderSkillDetail,
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
  ProviderInfo,
  ProvidersResponse,
  ReviewItem,
  Snapshot,
  Task,
  UpdateTaskInput,
} from "./types";

const BASE_URL = import.meta.env.VITE_CORE_URL ?? "http://127.0.0.1:8765";
const TOKEN = import.meta.env.VITE_CORE_TOKEN ?? "";

export type HealthResponse = {
  status: string;
  version: string;
};

function withAuth(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  if (TOKEN) result.set("X-Kova-Token", TOKEN);
  return result;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = withAuth(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers });
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
  const response = await fetch(`${BASE_URL}/health`, { headers: withAuth() });
  if (!response.ok) {
    throw new Error(`Core health check failed: ${response.status}`);
  }
  return response.json() as Promise<HealthResponse>;
}

export async function getProject(): Promise<ProjectResponse | null> {
  const response = await fetch(`${BASE_URL}/project`, { headers: withAuth() });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GET /project: ${response.status}`);
  }
  return response.json() as Promise<ProjectResponse>;
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
  return `${BASE_URL}${path}`;
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

export async function listBlenderSkills(): Promise<BlenderSkill[]> {
  return request<BlenderSkill[]>("/blender/skills");
}

export async function getBlenderSkill(name: string): Promise<BlenderSkillDetail> {
  return request<BlenderSkillDetail>(
    `/blender/skills/${encodeURIComponent(name)}`,
  );
}

export async function captureBlenderScreenshot(): Promise<string> {
  await request<{ path: string }>("/blender/screenshot", { method: "POST" });
  return `${BASE_URL}/blender/screenshot?v=${Date.now()}`;
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
}): Promise<AiRun> {
  return request<AiRun>("/ai/runs", {
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

export async function listAiSessions(taskId: string, limit = 20): Promise<AgentSession[]> {
  return request<AgentSession[]>(
    `/ai/sessions?task_id=${encodeURIComponent(taskId)}&limit=${limit}`,
  );
}

export async function listAiRuns(taskId: string): Promise<AiRun[]> {
  return request<AiRun[]>(`/ai/runs?task_id=${encodeURIComponent(taskId)}`);
}

export async function cancelAiRun(runId: string): Promise<AiRun> {
  return request<AiRun>(`/ai/runs/${encodeURIComponent(runId)}/cancel`, {
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
