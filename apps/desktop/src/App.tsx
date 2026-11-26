import { useCallback, useEffect, useState } from "react";
import Inspector from "./components/Inspector";
import Sidebar from "./components/Sidebar";
import TitleBar from "./components/TitleBar";
import TopBar from "./components/TopBar";
import { useConfirm } from "./components/ConfirmProvider";
import ActivityModal from "./features/activity/ActivityModal";
import AgentsScreen from "./features/agents/AgentsScreen";
import ChatScreen from "./features/chat/ChatScreen";
import AssetPassportScreen from "./features/assets/AssetPassportScreen";
import AssetsScreen from "./features/assets/AssetsScreen";
import BlenderModal from "./features/blender/BlenderModal";
import DoctorScreen from "./features/doctor/DoctorScreen";
import SettingsScreen from "./features/settings/SettingsScreen";
import RobloxModal from "./features/roblox/RobloxModal";
import {
  DEFAULT_CHAT_PREFERENCES,
  applyChatPreferences,
  loadChatPreferences,
  saveChatPreferences,
} from "./lib/chatPreferences";
import OverviewScreen from "./features/overview/OverviewScreen";
import ProjectsScreen from "./features/projects/ProjectsScreen";
import SkillsScreen from "./features/skills/SkillsScreen";
import EditorScreen from "./features/editor/EditorScreen";
import ReviewScreen from "./features/review/ReviewScreen";
import SectionPlaceholder from "./features/SectionPlaceholder";
import SnapshotsScreen from "./features/snapshots/SnapshotsScreen";
import CapsuleModal from "./features/tasks/CapsuleModal";
import ResponseModal from "./features/tasks/ResponseModal";
import SkillPickerModal from "./features/tasks/SkillPickerModal";
import TaskDetail from "./features/tasks/TaskDetail";
import TaskDialog from "./features/tasks/TaskDialog";
import TasksScreen from "./features/tasks/TasksScreen";
import {
  acceptReview,
  cleanupSnapshots,
  deleteSnapshot,
  activateAssetVersion,
  addAssetVersion,
  captureBlenderScreenshot,
  checkProvider,
  connectBlender,
  coreHealth,
  coreUrl,
  createProject,
  createProvider,
  createSnapshot,
  createTask,
  deleteProjectCard,
  deleteAsset,
  deleteProvider,
  deleteTask,
  duplicateAsset,
  duplicateProjectCard,
  ensureBlenderWorkspace,
  getAssetChecks,
  getBlenderStatus,
  getBlenderWorkspace,
  getDoctor,
  getProject,
  getRobloxStatus,
  getStats,
  importAsset,
  inspectAssetWithBlender,
  importResponse,
  listAssets,
  listBlenderSkills,
  listLedger,
  listProjects,
  listProviders,
  listReview,
  listTrashTasks,
  listSnapshots,
  listTasks,
  openDemoProject,
  openProjectCard,
  prepareCapsule,
  purgeTask,
  restoreTask,
  restoreSnapshot,
  reworkReview,
  runAssetChecks,
  setProjectCover,
  setupBlender,
  updateAsset,
  updateProject,
  updateProjectCard,
  updateProvider,
  updateTask,
} from "./lib/coreClient";
import { pickFile } from "./lib/dialogs";
import type {
  AssetPassport,
  BlenderSkill,
  BlenderStatus,
  BlenderWorkspace,
  CheckResult,
  CoreStatus,
  CreateProjectInput,
  CreateTaskInput,
  DuplicateProjectInput,
  Engine,
  LedgerEvent,
  Project,
  ProjectCard,
  ProjectStats,
  ProviderInfo,
  ReviewItem,
  RobloxStatus,
  Section,
  Snapshot,
  Task,
  TaskStatus,
} from "./lib/types";

export default function App() {
  const confirm = useConfirm();
  const [active, setActive] = useState<Section>("Обзор");
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = window.localStorage.getItem("kova-theme");
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });
  const [chatPreferences, setChatPreferences] = useState(loadChatPreferences);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem("kova-sidebar-collapsed") === "1",
  );
  const [core, setCore] = useState<CoreStatus>("checking");
  const [robloxStatus, setRobloxStatus] = useState<RobloxStatus | null>(null);
  const [robloxOpen, setRobloxOpen] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [defaultProjectParent, setDefaultProjectParent] = useState("");
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [defaultProvider, setDefaultProvider] = useState("");
  const [toast, setToast] = useState<{ text: string; tone: "error" | "warning" } | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [trashTasks, setTrashTasks] = useState<Task[]>([]);
  const [assets, setAssets] = useState<AssetPassport[]>([]);
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [ledger, setLedger] = useState<LedgerEvent[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [doctor, setDoctor] = useState<CheckResult[]>([]);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskDialogAssetIds, setTaskDialogAssetIds] = useState<string[]>([]);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [skillPickerTaskId, setSkillPickerTaskId] = useState<string | null>(null);
  const [openAssetId, setOpenAssetId] = useState<string | null>(null);
  const [assetChecks, setAssetChecks] = useState<CheckResult[]>([]);
  const [checkingAsset, setCheckingAsset] = useState(false);
  const [blenderRunning, setBlenderRunning] = useState(false);
  const [blenderStatus, setBlenderStatus] = useState<BlenderStatus | null>(null);
  const [blenderOpen, setBlenderOpen] = useState(false);
  const [blenderBusy, setBlenderBusy] = useState<
    "connect" | "setup" | "workspace" | "shot" | null
  >(null);
  const [blenderError, setBlenderError] = useState<string | null>(null);
  const [blenderWorkspace, setBlenderWorkspace] = useState<BlenderWorkspace | null>(null);
  const [blenderSkills, setBlenderSkills] = useState<BlenderSkill[]>([]);
  const [blenderScreenshot, setBlenderScreenshot] = useState<string | null>(null);
  const [importingAsset, setImportingAsset] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [capsuleText, setCapsuleText] = useState<string | null>(null);
  const [responseOpen, setResponseOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  const loadProjectData = useCallback(async () => {
    let current = await getProject();
    if (!current) current = await openDemoProject();
    const [
      tasksData,
      trashData,
      assetsData,
      statsData,
      reviewData,
      ledgerData,
      snapshotsData,
      doctorData,
      projectsData,
    ] = await Promise.all([
      listTasks(),
      listTrashTasks(),
      listAssets(),
      getStats(),
      listReview(),
      listLedger(300),
      listSnapshots(),
      getDoctor(),
      listProjects(),
    ]);
    setProject(current.project);
    setProjectPath(current.path);
    setTasks(tasksData);
    setTrashTasks(trashData);
    setAssets(assetsData);
    setStats(statsData);
    setReview(reviewData);
    setLedger(ledgerData);
    setSnapshots(snapshotsData);
    setDoctor(doctorData);
    setProjects(projectsData.projects);
    setDefaultProjectParent(projectsData.default_parent);
  }, []);

  const reload = useCallback(async () => {
    try {
      await loadProjectData();
    } catch {
      setStats(null);
    }
  }, [loadProjectData]);

  const refreshBlender = useCallback(async () => {
    try {
      setBlenderStatus(await getBlenderStatus());
    } catch {
      setBlenderStatus(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      await coreHealth();
    } catch {
      setCore("offline");
      return;
    }
    setCore("ok");
    await Promise.all([reload(), refreshBlender()]);
  }, [reload, refreshBlender]);

  const notify = useCallback((text: string, tone: "error" | "warning" = "error") => {
    setToast({ text, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    listBlenderSkills()
      .then(setBlenderSkills)
      .catch(() => setBlenderSkills([]));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("kova-theme", theme);
  }, [theme]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      getRobloxStatus()
        .then((value) => {
          if (alive) setRobloxStatus(value);
        })
        .catch(() => {
          if (alive) setRobloxStatus(null);
        });
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    applyChatPreferences(chatPreferences);
    saveChatPreferences(chatPreferences);
  }, [chatPreferences]);

  const toggleTheme = useCallback(
    () => setTheme((current) => (current === "dark" ? "light" : "dark")),
    [],
  );

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("kova-sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  }, []);

  const handleCreateTask = useCallback(
    async (input: CreateTaskInput) => {
      await createTask(input);
      setTaskDialogOpen(false);
      await reload();
    },
    [reload],
  );

  const handleStatusChange = useCallback(
    async (taskId: string, status: TaskStatus) => {
      try {
        await updateTask(taskId, { status });
        await loadProjectData();
      } catch {
        setStats(null);
      }
    },
    [loadProjectData],
  );

  const handleTaskSkills = useCallback(
    async (names: string[]) => {
      if (!skillPickerTaskId) return;
      await updateTask(skillPickerTaskId, { skills: names });
      setSkillPickerTaskId(null);
      await loadProjectData();
    },
    [loadProjectData, skillPickerTaskId],
  );

  const refreshProviders = useCallback(async () => {
    try {
      const data = await listProviders();
      setProviders(data.providers);
      setDefaultProvider(data.default_provider);
    } catch {
      // Keep the last known providers: the core may still be starting.
    }
  }, []);

  useEffect(() => {
    void refreshProviders();
    const timer = window.setInterval(() => void refreshProviders(), 4000);
    return () => window.clearInterval(timer);
  }, [refreshProviders]);

  const handleSaveProvider = useCallback(
    async (
      providerId: string,
      input: {
        name?: string;
        description?: string;
        command?: string;
        args?: string[];
        enabled?: boolean;
        timeout?: number;
        models?: string[];
        default_model?: string;
        models_args?: string[];
        read_only_args?: string[];
        resume_args?: string[];
        session_regex?: string;
        output_mode?: string;
        kind?: "cli" | "api";
        api_url?: string;
        api_model?: string;
        api_style?: "openai" | "anthropic" | "google" | "azure" | "vertex" | "bedrock";
        api_max_tokens?: number;
        catalog_id?: string;
        gcp_project?: string;
        gcp_region?: string;
        aws_region?: string;
        api_key?: string;
        delete_key?: boolean;
        set_default?: boolean;
      },
    ) => {
      await updateProvider(providerId, input);
      await refreshProviders();
    },
    [refreshProviders],
  );

  const handleCreateProvider = useCallback(
    async (input: {
      name: string;
      command: string;
      args?: string[];
      description?: string;
      timeout?: number;
      models?: string[];
      default_model?: string;
      models_args?: string[];
      read_only_args?: string[];
      resume_args?: string[];
      session_regex?: string;
      output_mode?: string;
      kind?: "cli" | "api";
      api_url?: string;
      api_model?: string;
      api_style?: "openai" | "anthropic" | "google" | "azure" | "vertex" | "bedrock";
      api_max_tokens?: number;
      catalog_id?: string;
      gcp_project?: string;
      gcp_region?: string;
      aws_region?: string;
      api_key?: string;
      delete_key?: boolean;
      set_default?: boolean;
    }) => {
      await createProvider(input);
      await refreshProviders();
    },
    [refreshProviders],
  );

  const handleCheckProvider = useCallback(
    async (providerId: string) => {
      await checkProvider(providerId);
      await refreshProviders();
    },
    [refreshProviders],
  );

  const handleSetDefaultProvider = useCallback(
    async (providerId: string) => {
      await updateProvider(providerId, { set_default: true });
      await refreshProviders();
    },
    [refreshProviders],
  );

  const handleDeleteProvider = useCallback(
    async (providerId: string) => {
      await deleteProvider(providerId);
      await refreshProviders();
    },
    [refreshProviders],
  );

  const grantRemoteConsent = async (providerId: string) => {
    const current = project?.remote_consents ?? [];
    if (current.includes(providerId)) return;
    const data = await updateProject({
      remote_consents: [...current, providerId],
    });
    setProject(data.project);
  };

  const refreshProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const data = await listProjects();
      setProjects(data.projects);
      setDefaultProjectParent(data.default_parent);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  const handleCreateProject = useCallback(
    async (input: CreateProjectInput) => {
      await createProject(input);
      await loadProjectData();
      setActive("Обзор");
    },
    [loadProjectData],
  );

  const handleOpenProjectCard = useCallback(
    async (projectId: string) => {
      await openProjectCard(projectId);
      setOpenTaskId(null);
      setOpenAssetId(null);
      await loadProjectData();
      setActive("Обзор");
    },
    [loadProjectData],
  );

  const handleUpdateProject = useCallback(
    async (projectId: string, input: { name?: string; engine?: Engine }) => {
      await updateProjectCard(projectId, input);
      await loadProjectData();
    },
    [loadProjectData],
  );

  const handleDuplicateProject = useCallback(
    async (projectId: string, input: DuplicateProjectInput) => {
      await duplicateProjectCard(projectId, input);
      await loadProjectData();
    },
    [loadProjectData],
  );

  const handleDeleteProject = useCallback(
    async (projectId: string, deleteFiles: boolean) => {
      await deleteProjectCard(projectId, deleteFiles);
      const data = await listProjects();
      if (!data.projects.some((item) => item.active)) {
        if (data.projects.length > 0) {
          await openProjectCard(data.projects[0].id);
        } else {
          await openDemoProject();
        }
      }
      setOpenTaskId(null);
      setOpenAssetId(null);
      await loadProjectData();
    },
    [loadProjectData],
  );

  const handleProjectCover = useCallback(
    async (projectId: string, path: string) => {
      await setProjectCover(projectId, path);
      await loadProjectData();
    },
    [loadProjectData],
  );

  const handleArchiveTask = useCallback(
    async (taskId: string) => {
      await updateTask(taskId, { status: "archived" });
      await loadProjectData();
    },
    [loadProjectData],
  );

  const handleRestoreTask = useCallback(
    async (taskId: string) => {
      await updateTask(taskId, { status: "draft" });
      await loadProjectData();
    },
    [loadProjectData],
  );

  const requestDeleteTask = useCallback(
    async (task: Task) => {
      const ok = await confirm({
        title: "Удалить задачу?",
        message: `Задача «${task.title}» переместится в корзину.`,
        details: [
          "Задачу можно восстановить из корзины.",
          "Ассеты и файлы проекта не удаляются.",
        ],
        confirmLabel: "В корзину",
        danger: true,
      });
      if (!ok) return;
      await deleteTask(task.id);
      if (openTaskId === task.id) setOpenTaskId(null);
      await loadProjectData();
    },
    [confirm, loadProjectData, openTaskId],
  );

  const handleRestoreTrash = useCallback(
    async (taskId: string) => {
      await restoreTask(taskId);
      await loadProjectData();
    },
    [loadProjectData],
  );

  const requestPurgeTask = useCallback(
    async (task: Task) => {
      const ok = await confirm({
        title: "Удалить задачу навсегда?",
        message: `Задача «${task.title}» и её файлы будут удалены.`,
        details: ["Это действие нельзя отменить.", "Корзина не сохранит копию."],
        confirmLabel: "Удалить навсегда",
        danger: true,
      });
      if (!ok) return;
      await purgeTask(task.id);
      await loadProjectData();
    },
    [confirm, loadProjectData],
  );

  const handleCapsule = useCallback(
    async (taskId: string) => {
      const result = await prepareCapsule(taskId);
      setCapsuleText(result.text);
      await reload();
    },
    [reload],
  );

  const handleResponse = useCallback(
    async (text: string) => {
      if (!openTaskId) return;
      await importResponse(openTaskId, text);
      setResponseOpen(false);
      await reload();
    },
    [openTaskId, reload],
  );

  const handleAccept = useCallback(
    async (reviewId: string) => {
      try {
        await acceptReview(reviewId);
        await loadProjectData();
      } catch {
        setStats(null);
      }
    },
    [loadProjectData],
  );

  const handleRework = useCallback(
    async (reviewId: string) => {
      try {
        await reworkReview(reviewId);
        await loadProjectData();
      } catch {
        setStats(null);
      }
    },
    [loadProjectData],
  );

  const handleCreateSnapshot = useCallback(
    async (reason: string) => {
      await createSnapshot(reason);
      await reload();
    },
    [reload],
  );

  const handleDeleteSnapshot = useCallback(
    async (snapshotId: string) => {
      await deleteSnapshot(snapshotId);
      await loadProjectData();
    },
    [loadProjectData],
  );

  const handleCleanupSnapshots = useCallback(async () => {
    await cleanupSnapshots(10, 30);
    await loadProjectData();
  }, [loadProjectData]);

  const handleRestoreSnapshot = useCallback(
    async (snapshotId: string) => {
      const ok = await confirm({
        title: "Откатить проект?",
        message: "Файлы проекта вернутся к выбранному снапшоту.",
        details: [
          "Текущее состояние сначала сохранится отдельным снапшотом.",
          "Незакоммиченные изменения вне проекта не затрагиваются.",
        ],
        confirmLabel: "Откатить",
        danger: true,
      });
      if (!ok) return;
      try {
        await restoreSnapshot(snapshotId);
        await loadProjectData();
      } catch {
        setStats(null);
      }
    },
    [loadProjectData],
  );

  const handleDeleteAsset = useCallback(
    async (assetId: string) => {
      const asset = assets.find((item) => item.id === assetId);
      const ok = await confirm({
        title: "Удалить ассет?",
        message: `Ассет «${asset?.name ?? assetId}» будет удалён из библиотеки.`,
        details: [
          "Будут удалены паспорт, превью и проверки.",
          "Скопированные файлы удалятся, если их не использует другой ассет.",
          "Связи с задачами будут сняты.",
        ],
        confirmLabel: "Удалить",
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteAsset(assetId);
        if (openAssetId === assetId) setOpenAssetId(null);
        await loadProjectData();
      } catch (err) {
        setAssetError(err instanceof Error ? err.message : "Не удалось удалить ассет");
      }
    },
    [assets, loadProjectData, openAssetId],
  );

  const handleDuplicateAsset = useCallback(
    async (assetId: string) => {
      try {
        const copy = await duplicateAsset(assetId);
        await loadProjectData();
        setOpenAssetId(copy.id);
        setAssetChecks([]);
      } catch (err) {
        setAssetError(err instanceof Error ? err.message : "Не удалось создать копию");
      }
    },
    [loadProjectData],
  );

  const openAsset = useCallback(async (assetId: string) => {
    setOpenAssetId(assetId);
    setAssetError(null);
    try {
      setAssetChecks(await getAssetChecks(assetId));
    } catch {
      setAssetChecks([]);
    }
  }, []);

  const openAssetVersion = useCallback(async (versionId: string) => {
    if (!openAssetId) return;
    try {
      setAssetChecks(await getAssetChecks(openAssetId, versionId));
    } catch {
      setAssetChecks([]);
    }
  }, [openAssetId]);

  const handleImportAsset = useCallback(async (taskId?: string) => {
    if (!("__TAURI_INTERNALS__" in window)) {
      setAssetError("Импорт доступен в десктоп-приложении");
      return;
    }
    setImportingAsset(true);
    setAssetError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: true,
        directory: false,
        title: "Импорт ассетов",
      });
      const paths = Array.isArray(selected)
        ? selected
        : selected
          ? [selected]
          : [];
      if (paths.length === 0) return;

      let firstId: string | null = null;
      for (const path of paths) {
        const imported = await importAsset({
          path,
          engine: project?.engine ?? "roblox",
          task_id: taskId,
        });
        if (!firstId) firstId = imported.id;
      }
      await loadProjectData();
      if (!taskId && firstId) await openAsset(firstId);
    } catch (err) {
      setAssetError(err instanceof Error ? err.message : "Не удалось импортировать ассет");
    } finally {
      setImportingAsset(false);
    }
  }, [loadProjectData, openAsset, project?.engine]);

  const handleLinkAssetTasks = useCallback(
    async (taskIds: string[]) => {
      if (!openAssetId) return;
      try {
        await updateAsset(openAssetId, { task_ids: taskIds });
        await loadProjectData();
      } catch (err) {
        setAssetError(err instanceof Error ? err.message : "Не удалось обновить связи");
      }
    },
    [openAssetId, loadProjectData],
  );

  const handleAssetDescription = useCallback(
    async (text: string) => {
      if (!openAssetId) return;
      try {
        await updateAsset(openAssetId, { description: text });
        await loadProjectData();
      } catch (err) {
        setAssetError(err instanceof Error ? err.message : "Не удалось сохранить описание");
      }
    },
    [openAssetId, loadProjectData],
  );

  const handleAddAssetVersion = useCallback(async () => {
    if (!openAssetId) return;
    const selected = await pickFile("Новая версия ассета", [
      "blend",
      "fbx",
      "glb",
      "gltf",
      "obj",
      "png",
      "jpg",
      "jpeg",
      "webp",
      "wav",
      "mp3",
    ]);
    if (!selected) return;
    try {
      const updated = await addAssetVersion(openAssetId, selected, "Новая версия", true);
      await loadProjectData();
      setAssetChecks(await getAssetChecks(openAssetId, updated.current_version_id ?? undefined));
    } catch (err) {
      setAssetError(err instanceof Error ? err.message : "Не удалось добавить версию");
    }
  }, [loadProjectData, openAssetId]);

  const handleActivateAssetVersion = useCallback(
    async (versionId: string) => {
      if (!openAssetId) return;
      try {
        const updated = await activateAssetVersion(openAssetId, versionId);
        await loadProjectData();
        setAssetChecks(await getAssetChecks(openAssetId, updated.current_version_id ?? undefined));
      } catch (err) {
        setAssetError(err instanceof Error ? err.message : "Не удалось переключить версию");
      }
    },
    [loadProjectData, openAssetId],
  );

  const handleRunAssetChecks = useCallback(async () => {
    if (!openAssetId) return;
    setCheckingAsset(true);
    setAssetError(null);
    try {
      await runAssetChecks(openAssetId);
      setAssetChecks(await getAssetChecks(openAssetId));
      await loadProjectData();
    } catch (err) {
      setAssetError(err instanceof Error ? err.message : "Не удалось выполнить проверки");
    } finally {
      setCheckingAsset(false);
    }
  }, [openAssetId, loadProjectData]);

  const handleRunBlender = useCallback(async () => {
    if (!openAssetId) return;
    setBlenderRunning(true);
    setAssetError(null);
    try {
      const result = await inspectAssetWithBlender(openAssetId);
      setAssetChecks(result.checks);
      await loadProjectData();
    } catch (err) {
      setAssetError(err instanceof Error ? err.message : "Blender не смог проверить ассет");
    } finally {
      setBlenderRunning(false);
    }
  }, [openAssetId, loadProjectData]);

  const refreshBlenderPanel = useCallback(async () => {
    await refreshBlender();
    setBlenderWorkspace(await getBlenderWorkspace().catch(() => null));
  }, [refreshBlender]);

  const openBlenderModal = useCallback(() => {
    setBlenderOpen(true);
    setBlenderError(null);
    void refreshBlenderPanel();
    listBlenderSkills()
      .then(setBlenderSkills)
      .catch(() => setBlenderSkills([]));
  }, [refreshBlenderPanel]);

  const handleBlenderConnect = useCallback(async () => {
    setBlenderBusy("connect");
    setBlenderError(null);
    try {
      const status = await connectBlender();
      setBlenderStatus(status);
      if (status.connected) {
        setBlenderWorkspace(await getBlenderWorkspace().catch(() => null));
        await loadProjectData();
      }
    } catch (err) {
      setBlenderError(err instanceof Error ? err.message : "Не удалось подключить Blender");
      await refreshBlender();
    } finally {
      setBlenderBusy(null);
    }
  }, [loadProjectData, refreshBlender]);

  const handleBlenderSetup = useCallback(async () => {
    setBlenderBusy("setup");
    setBlenderError(null);
    try {
      setBlenderStatus(await setupBlender());
    } catch (err) {
      setBlenderError(err instanceof Error ? err.message : "Не удалось установить аддон");
    } finally {
      setBlenderBusy(null);
    }
  }, []);

  const handleBlenderWorkspace = useCallback(async () => {
    setBlenderBusy("workspace");
    setBlenderError(null);
    try {
      setBlenderWorkspace(await ensureBlenderWorkspace());
      await loadProjectData();
    } catch (err) {
      setBlenderError(err instanceof Error ? err.message : "Не удалось создать папку моделей");
    } finally {
      setBlenderBusy(null);
    }
  }, [loadProjectData]);

  const handleBlenderScreenshot = useCallback(async () => {
    setBlenderBusy("shot");
    setBlenderError(null);
    try {
      setBlenderScreenshot(await captureBlenderScreenshot());
      await loadProjectData();
    } catch (err) {
      setBlenderError(err instanceof Error ? err.message : "Не удалось сделать снимок");
    } finally {
      setBlenderBusy(null);
    }
  }, [loadProjectData]);

  const handleOpenFolder = useCallback(async (path: string) => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_project_folder", { path });
  }, []);

  const handleOpenProjectFolder = useCallback(async () => {
    if (!projectPath) return;
    await handleOpenFolder(projectPath);
  }, [handleOpenFolder, projectPath]);

  const openTaskDialog = useCallback(() => {
    setTaskDialogAssetIds([]);
    setTaskDialogOpen(true);
  }, []);

  const openTaskForAsset = useCallback((assetId: string) => {
    setTaskDialogAssetIds([assetId]);
    setTaskDialogOpen(true);
  }, []);
  const closeTaskDialog = useCallback(() => setTaskDialogOpen(false), []);
  const closeCapsule = useCallback(() => setCapsuleText(null), []);
  const closeResponse = useCallback(() => setResponseOpen(false), []);
  const backToTasks = useCallback(() => setOpenTaskId(null), []);

  const projectName = project?.name ?? "Blade Evolve";
  const projectEngine = project?.engine ?? "roblox";
  const pendingReviewCount = review.filter((item) => item.status === "pending").length;
  const activeTaskCount =
    stats?.tasks_active ??
    tasks.filter((task) => task.status !== "done" && task.status !== "archived").length;
  const blockedTaskCount = tasks.filter((task) => task.status === "blocked").length;
  const problemAssetCount = stats?.assets_problems ?? 0;
  const doctorIssues = doctor.filter((check) =>
    ["failed", "error", "warning"].includes(check.status),
  ).length;
  const gitCheck = doctor.find((check) => check.name === "Git") ?? null;
  const git = gitCheck
    ? { ok: gitCheck.status === "passed", message: gitCheck.message }
    : null;

  const tip = !blenderStatus?.connected
    ? {
        title: "Подключи Blender",
        text: "Kova сможет собирать модели, запускать QA и делать превью прямо из задачи.",
        action: "Открыть Blender",
        onAction: openBlenderModal,
      }
    : pendingReviewCount > 0
      ? {
          title: "Есть что проверить",
          text: "Результаты AI ждут приёмки. Прими удачные и отправь слабые на доработку.",
          action: "Открыть Review",
          onAction: () => setActive("Review"),
        }
      : assets.length === 0
        ? {
            title: "Добавь первый ассет",
            text: "Импортируй модель или текстуру — Kova сохранит паспорт, версию и проверки.",
            action: "Импортировать",
            onAction: () => void handleImportAsset(),
          }
        : activeTaskCount === 0
          ? {
              title: "Задач нет",
              text: "Открой раздел «Задачи» и создай первую — Kova соберёт капсулу и выбранные скиллы.",
              action: "Открыть задачи",
              onAction: () => setActive("Задачи"),
            }
          : {
              title: "Проект в порядке",
              text: "Можно продолжать работу или проверить окружение через Doctor.",
              action: "Открыть Doctor",
              onAction: () => setActive("Doctor"),
            };
  const activeProjectCard =
    projects.find((item) => item.active) ??
    projects.find((item) => item.path === projectPath);
  const projectCoverUrl = activeProjectCard?.cover_url
    ? coreUrl(activeProjectCard.cover_url)
    : null;
  const openTask = tasks.find((task) => task.id === openTaskId) ?? null;
  const skillPickerTask = tasks.find((task) => task.id === skillPickerTaskId) ?? null;
  const selectedAsset = assets.find((asset) => asset.id === openAssetId) ?? null;

  return (
    <div className="app">
      <TitleBar />
      <div
        className={`app-body${inspectorOpen ? "" : " is-inspector-hidden"}${
          sidebarCollapsed ? " is-sidebar-collapsed" : ""
        }`}
      >
        <Sidebar
          active={active}
          onSelect={setActive}
          projectName={projectName}
          engine={projectEngine}
          projectCover={projectCoverUrl}
          onOpenProjects={() => setActive("Проекты")}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={toggleSidebar}
          taskCount={activeTaskCount}
          reviewCount={pendingReviewCount}
        />
        <main className="main">
          <TopBar
            section={active}
            core={core}
            projectName={projectName}
            theme={theme}
            inspectorOpen={inspectorOpen}
            reviewCount={pendingReviewCount}
            toolIssues={doctor.length === 0 ? null : doctorIssues}
            onToggleTheme={toggleTheme}
            onShowInspector={() => setInspectorOpen(true)}
            onOpenReview={() => setActive("Review")}
            onOpenSettings={() => setActive("Настройки")}
          />
          {active === "Обзор" ? (
            <OverviewScreen
              project={project}
              projectPath={projectPath}
              tasks={tasks}
              assets={assets}
              review={review}
              projects={projects}
              events={ledger}
              blender={blenderStatus}
              importing={importingAsset}
              onCreateTask={openTaskDialog}
              onImportAsset={() => void handleImportAsset()}
              onOpenEditor={() => setActive("Редактор")}
              onOpenBlender={openBlenderModal}
              onOpenProjects={() => setActive("Проекты")}
              onOpenTasks={() => setActive("Задачи")}
              onOpenTask={(taskId) => {
                setActive("Задачи");
                setOpenTaskId(taskId);
              }}
              onOpenProject={(projectId) => void handleOpenProjectCard(projectId)}
              onOpenReview={() => setActive("Review")}
              onOpenAssets={() => setActive("Ассеты")}
              onOpenActivity={() => setActivityOpen(true)}
            />
          ) : active === "Проекты" ? (
            <ProjectsScreen
              projects={projects}
              defaultParent={defaultProjectParent}
              loading={projectsLoading}
              onRefresh={() => void refreshProjects()}
              onOpen={handleOpenProjectCard}
              onCreate={handleCreateProject}
              onUpdate={handleUpdateProject}
              onDuplicate={handleDuplicateProject}
              onDelete={handleDeleteProject}
              onCover={handleProjectCover}
            />
          ) : active === "Скиллы" ? (
            <SkillsScreen
              skills={blenderSkills}
              tasks={tasks}
              onChanged={() => {
                listBlenderSkills()
                  .then(setBlenderSkills)
                  .catch(() => undefined);
              }}
            />
          ) : active === "Агенты" ? (
            <AgentsScreen
              providers={providers}
              onRefresh={() => void refreshProviders()}
              onSave={handleSaveProvider}
              onCreate={handleCreateProvider}
              onCheck={handleCheckProvider}
              onSetDefault={handleSetDefaultProvider}
              onDelete={handleDeleteProvider}
              onOpenTask={(taskId) => {
                setActive("Задачи");
                setOpenTaskId(taskId);
              }}
            />
          ) : active === "Ассеты" ? (
            selectedAsset ? (
              <AssetPassportScreen
                asset={selectedAsset}
                tasks={tasks}
                checks={assetChecks}
                checking={checkingAsset}
                blenderInstalled={blenderStatus?.installed ?? false}
                blenderRunning={blenderRunning}
                onBack={() => setOpenAssetId(null)}
                onRunChecks={() => void handleRunAssetChecks()}
                onRunBlender={() => void handleRunBlender()}
                onOpenFolder={() => void handleOpenProjectFolder()}
                onLinkTasks={(taskIds) => void handleLinkAssetTasks(taskIds)}
                onCreateTask={() => openTaskForAsset(selectedAsset.id)}
                onSelectVersion={(versionId) => void openAssetVersion(versionId)}
                onOpenTask={(taskId) => {
                  setActive("Задачи");
                  setOpenTaskId(taskId);
                }}
                onUpdateDescription={(text) => void handleAssetDescription(text)}
                onAddVersion={() => void handleAddAssetVersion()}
                onActivateVersion={(versionId) => void handleActivateAssetVersion(versionId)}
                onDelete={() => void handleDeleteAsset(selectedAsset.id)}
                onDuplicate={() => void handleDuplicateAsset(selectedAsset.id)}
                onOpenEditor={() => {
                  setOpenAssetId(null);
                  setActive("Редактор");
                }}
              />
            ) : (
              <AssetsScreen
                assets={assets}
                importing={importingAsset}
                error={assetError}
                onImport={() => void handleImportAsset()}
                onOpenAsset={(assetId) => void openAsset(assetId)}
                onDeleteAsset={(assetId) => void handleDeleteAsset(assetId)}
              />
            )
          ) : active === "Чат" ? (
            <ChatScreen
              providers={providers}
              defaultProvider={defaultProvider}
              tasks={tasks}
              engine={project?.engine ?? "generic"}
              localOnly={project?.local_only ?? false}
              remoteConsents={project?.remote_consents ?? []}
              onGrantConsent={grantRemoteConsent}
              onProjectChanged={() => void loadProjectData()}
              chatPreferences={chatPreferences}
              onOpenTask={(taskId) => {
                setActive("Задачи");
                setOpenTaskId(taskId);
              }}
              onTasksChanged={() => void loadProjectData()}
            />
          ) : active === "Задачи" ? (
            openTask ? (
              <TaskDetail
                task={openTask}
                assets={assets.filter((asset) => asset.task_ids.includes(openTask.id))}
                providers={providers}
                defaultProvider={defaultProvider}
                events={ledger}
                importing={importingAsset}
                onBack={backToTasks}
                onStatusChange={handleStatusChange}
                onCapsule={() => void handleCapsule(openTask.id)}
                onResponse={() => setResponseOpen(true)}
                onImportAsset={() => void handleImportAsset(openTask.id)}
                onOpenAsset={(assetId) => {
                  setActive("Ассеты");
                  void openAsset(assetId);
                }}
                onEditSkills={() => setSkillPickerTaskId(openTask.id)}
                onOpenAgents={() => setActive("Агенты")}
                onTaskChanged={loadProjectData}
                onNotify={notify}
                onArchive={() => void handleArchiveTask(openTask.id)}
                onRestore={() => void handleRestoreTask(openTask.id)}
                onDelete={() => requestDeleteTask(openTask)}
              />
            ) : (
              <TasksScreen
                tasks={tasks}
                trashTasks={trashTasks}
                assets={assets}
                projectCover={projectCoverUrl}
                projectName={projectName}
                onCreateTask={openTaskDialog}
                onOpenTask={setOpenTaskId}
                onArchive={(taskId) => void handleArchiveTask(taskId)}
                onRestore={(taskId) => void handleRestoreTask(taskId)}
                onDelete={requestDeleteTask}
                onRestoreTrash={(taskId) => void handleRestoreTrash(taskId)}
                onPurge={requestPurgeTask}
              />
            )
          ) : active === "Review" ? (
            <ReviewScreen
              items={review}
              tasks={tasks}
              onAccept={handleAccept}
              onRework={handleRework}
            />
          ) : active === "Редактор" ? (
            <EditorScreen projectPath={projectPath} />
          ) : active === "Снапшоты" ? (
            <SnapshotsScreen
              snapshots={snapshots}
              onCreate={handleCreateSnapshot}
              onRestore={(id) => void handleRestoreSnapshot(id)}
              onDelete={handleDeleteSnapshot}
              onCleanup={handleCleanupSnapshots}
            />
          ) : active === "Настройки" ? (
            <SettingsScreen
              preferences={chatPreferences}
              onPreferences={setChatPreferences}
              onReset={() => setChatPreferences(DEFAULT_CHAT_PREFERENCES)}
            />
          ) : active === "Doctor" ? (
            <DoctorScreen checks={doctor} onRefresh={() => void reload()} />
          ) : (
            <SectionPlaceholder title={active} />
          )}
        </main>
        {inspectorOpen ? (
          <Inspector
            onClose={() => setInspectorOpen(false)}
            onOpenBlender={openBlenderModal}
            onOpenRoblox={() => setRobloxOpen(true)}
            roblox={robloxStatus}
            onOpenReview={() => setActive("Review")}
            onOpenAssets={() => setActive("Ассеты")}
            onOpenTasks={() => setActive("Задачи")}
            onOpenDoctor={() => setActive("Doctor")}
            onOpenSnapshots={() => setActive("Снапшоты")}
            blender={blenderStatus}
            git={git}
            attention={{
              reviews: pendingReviewCount,
              problems: problemAssetCount,
              blocked: blockedTaskCount,
              doctor: doctorIssues,
            }}
            snapshots={{
              count: snapshots.length,
              lastAt: snapshots[0]?.created_at ?? null,
            }}
            tip={tip}
          />
        ) : null}
      </div>
      {taskDialogOpen ? (
        <TaskDialog
          defaultEngine={projectEngine}
          initialAssetIds={taskDialogAssetIds}
          onClose={closeTaskDialog}
          onSubmit={handleCreateTask}
        />
      ) : null}
      {capsuleText !== null ? (
        <CapsuleModal text={capsuleText} onClose={closeCapsule} />
      ) : null}
      {responseOpen && openTask ? (
        <ResponseModal onClose={closeResponse} onSubmit={handleResponse} />
      ) : null}
      {activityOpen ? (
        <ActivityModal
          events={ledger}
          tasks={tasks}
          onClose={() => setActivityOpen(false)}
        />
      ) : null}
      {skillPickerTask ? (
        <SkillPickerModal
          task={skillPickerTask}
          skills={blenderSkills}
          onClose={() => setSkillPickerTaskId(null)}
          onSave={handleTaskSkills}
        />
      ) : null}
      {toast ? (
        <div className={`app-toast is-${toast.tone}`} role="status">
          <span>{toast.text}</span>
          <button type="button" aria-label="Закрыть" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      ) : null}
      {blenderOpen ? (
        <BlenderModal
          status={blenderStatus}
          workspace={blenderWorkspace}
          skills={blenderSkills}
          screenshot={blenderScreenshot}
          busy={blenderBusy}
          error={blenderError}
          onClose={() => setBlenderOpen(false)}
          onConnect={() => void handleBlenderConnect()}
          onSetup={() => void handleBlenderSetup()}
          onRefresh={() => void refreshBlenderPanel()}
          onWorkspace={() => void handleBlenderWorkspace()}
          onScreenshot={() => void handleBlenderScreenshot()}
          onOpenFolder={(path) => void handleOpenFolder(path)}
        />
      ) : null}
      {robloxOpen ? (
        <RobloxModal
          initialStatus={robloxStatus}
          projectPath={projectPath}
          onClose={() => setRobloxOpen(false)}
        />
      ) : null}
    </div>
  );
}
