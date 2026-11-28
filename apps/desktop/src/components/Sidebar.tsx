import { useEffect, useState } from "react";
import {
  BookOpen,
  Bot,
  Box,
  CalendarDays,
  Camera,
  ChevronDown,
  ClipboardList,
  Code2,
  FolderKanban,
  LayoutDashboard,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Puzzle,
  Sparkles,
  Star,
  Stethoscope,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { engineBrand } from "../lib/brands";
import { ENGINE_LABELS } from "../lib/labels";
import { t } from "../lib/i18n";
import type { Engine, Section } from "../lib/types";
import BrandIcon from "./BrandIcon";
import KovaLogo from "./KovaLogo";

type NavItem = {
  label: Section;
  icon: LucideIcon;
};

type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

const GROUPS: NavGroup[] = [
  {
    id: "workspace",
    label: "Рабочее пространство",
    items: [
      { label: "Обзор", icon: LayoutDashboard },
      { label: "Проекты", icon: FolderKanban },
      { label: "Задачи", icon: ClipboardList },
      { label: "Чат", icon: MessageSquare },
      { label: "Команда проекта", icon: Users },
    ],
  },
  {
    id: "creation",
    label: "Создание",
    items: [
      { label: "Ассеты", icon: Box },
      { label: "Скиллы", icon: Sparkles },
      { label: "Пакеты", icon: Puzzle },
    ],
  },
  {
    id: "control",
    label: "Контроль",
    items: [
      { label: "Review", icon: Star },
      { label: "Снапшоты", icon: Camera },
      { label: "Память", icon: BookOpen },
      { label: "Дневник", icon: CalendarDays },
    ],
  },
  {
    id: "tools",
    label: "Инструменты",
    items: [
      { label: "Агенты", icon: Bot },
      { label: "Ночная смена", icon: Moon },
      { label: "Doctor", icon: Stethoscope },
      { label: "Редактор", icon: Code2 },
    ],
  },
];

const GROUPS_KEY = "kova-sidebar-groups";

function readGroups(): Record<string, boolean> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(GROUPS_KEY) ?? "{}");
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

type Props = {
  active: Section;
  onSelect: (section: Section) => void;
  projectName: string;
  engine: Engine;
  projectCover: string | null;
  onOpenProjects: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  taskCount: number;
  reviewCount: number;
};

export default function Sidebar({
  active,
  onSelect,
  projectName,
  engine,
  projectCover,
  onOpenProjects,
  collapsed,
  onToggleCollapsed,
  taskCount,
  reviewCount,
}: Props) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(readGroups);

  useEffect(() => {
    window.localStorage.setItem(GROUPS_KEY, JSON.stringify(openGroups));
  }, [openGroups]);

  useEffect(() => {
    const group = GROUPS.find((item) =>
      item.items.some((entry) => entry.label === active),
    );
    if (!group) return;
    setOpenGroups((current) =>
      current[group.id] === false ? { ...current, [group.id]: true } : current,
    );
  }, [active]);

  const brand = engineBrand(engine);
  const isOpen = (group: NavGroup) => openGroups[group.id] !== false;

  const toggleGroup = (group: NavGroup) => {
    setOpenGroups((current) => ({
      ...current,
      [group.id]: !isOpen(group),
    }));
  };

  const counters: Partial<Record<Section, number>> = {
    Задачи: taskCount,
    Review: reviewCount,
  };

  const renderItem = ({ label, icon: Icon }: NavItem) => {
    const count = counters[label] ?? 0;
    const display = t(label);
    const title = count > 0 && collapsed ? `${display} · ${count}` : display;
    return (
      <button
        key={label}
        type="button"
        className={label === active ? "nav-item is-active" : "nav-item"}
        aria-current={label === active ? "page" : undefined}
        aria-label={display}
        title={title}
        data-section={label}
        onClick={() => onSelect(label)}
      >
        <Icon size={17} strokeWidth={1.8} className="nav-icon" />
        <span className="nav-label">{display}</span>
        {count > 0 ? <span className="nav-count">{count}</span> : null}
      </button>
    );
  };

  return (
    <aside className={`sidebar${collapsed ? " is-collapsed" : ""}`}>
      <div className="sidebar-logo">
        <KovaLogo size={20} className="brand-icon" />
        <span className="sidebar-brand">Kova Hub</span>
      </div>

      <button
        type="button"
        className="project-card"
        onClick={onOpenProjects}
        title={`${projectName} · ${ENGINE_LABELS[engine]}`}
      >
        {projectCover ? (
          <img className="project-thumb" src={projectCover} alt="" />
        ) : (
          <span className="project-thumb project-thumb-brand">
            {brand ? <BrandIcon name={brand} size={22} /> : <KovaLogo size={20} />}
          </span>
        )}
        <span className="project-meta">
          <span className="project-name">{projectName}</span>
          <span className="project-engine">
            {brand ? <BrandIcon name={brand} size={12} /> : null}
            {ENGINE_LABELS[engine]}
          </span>
        </span>
      </button>

      <nav className="nav">
        {GROUPS.map((group) => (
          <div className="nav-group" key={group.id}>
            {!collapsed ? (
              <button
                type="button"
                className="nav-group-head"
                onClick={() => toggleGroup(group)}
                aria-expanded={isOpen(group)}
              >
                <span>{t(group.label)}</span>
                <ChevronDown
                  size={12}
                  className={isOpen(group) ? "nav-group-chevron" : "nav-group-chevron is-closed"}
                />
              </button>
            ) : null}
            {collapsed || isOpen(group) ? (
              <div className="nav-group-items">{group.items.map(renderItem)}</div>
            ) : null}
          </div>
        ))}
      </nav>

      <div className="sidebar-spacer" />

      <div className="sidebar-footer">
        <button
          type="button"
          className="nav-item sidebar-collapse"
          onClick={onToggleCollapsed}
          title={collapsed ? t("Развернуть панель") : t("Свернуть панель")}
          aria-label={collapsed ? t("Развернуть панель") : t("Свернуть панель")}
        >
          {collapsed ? (
            <PanelLeftOpen size={17} strokeWidth={1.8} className="nav-icon" />
          ) : (
            <PanelLeftClose size={17} strokeWidth={1.8} className="nav-icon" />
          )}
          <span className="nav-label">{t("Свернуть")}</span>
        </button>
      </div>
    </aside>
  );
}
