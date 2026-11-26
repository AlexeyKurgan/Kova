import { useEffect, useMemo, useState } from "react";
import {
  Box,
  ChevronRight,
  FileAudio,
  Film,
  ImageIcon,
  Info,
  LayoutGrid,
  List,
  Lock,
  Package,
  Plus,
  Search,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { coreUrl } from "../../lib/coreClient";
import { formatBytes, formatDate, plural } from "../../lib/format";
import {
  ASSET_TYPE_LABELS,
  ASSET_VERSION_STATUS_LABELS,
  ENGINE_LABELS,
} from "../../lib/labels";
import type { AssetPassport, AssetVersionStatus, Engine } from "../../lib/types";

type Props = {
  assets: AssetPassport[];
  importing: boolean;
  error: string | null;
  onImport: () => void;
  onOpenAsset: (assetId: string) => void;
  onDeleteAsset: (assetId: string) => void;
};

const TYPE_ORDER = ["model", "texture", "animation", "effect", "audio", "scene", "code", "other"];

const TYPE_ICONS = {
  model: Box,
  texture: ImageIcon,
  animation: Film,
  effect: Sparkles,
  audio: FileAudio,
  scene: Package,
  code: Package,
  other: TriangleAlert,
};

function typeIcon(type: string) {
  return TYPE_ICONS[type as keyof typeof TYPE_ICONS] ?? Box;
}

export default function AssetsScreen({
  assets,
  importing,
  error,
  onImport,
  onOpenAsset,
  onDeleteAsset,
}: Props) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [engineFilter, setEngineFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("recent");
  const [view, setView] = useState<"grid" | "list">("list");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const engines = useMemo(
    () => [...new Set(assets.map((asset) => asset.engine))].sort(),
    [assets],
  );

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    const rows = assets.filter((asset) => {
      if (typeFilter !== "all" && asset.type !== typeFilter) return false;
      if (engineFilter !== "all" && asset.engine !== engineFilter) return false;
      if (statusFilter !== "all") {
        const current =
          asset.versions.find((item) => item.id === asset.current_version_id) ??
          asset.versions[asset.versions.length - 1];
        if (!current || current.status !== statusFilter) return false;
      }
      if (!search) return true;
      return `${asset.name} ${asset.path} ${asset.type} ${asset.origin}`
        .toLowerCase()
        .includes(search);
    });
    return [...rows].sort((left, right) => {
      if (sort === "name") return left.name.localeCompare(right.name, "ru");
      if (sort === "size") return right.file_size - left.file_size;
      return (right.updated_at || "").localeCompare(left.updated_at || "");
    });
  }, [assets, engineFilter, query, sort, statusFilter, typeFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
  }, [query, typeFilter, engineFilter, statusFilter, sort]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  return (
    <section className="assets-screen assets-library">
      <div className="assets-heading">
        <Box size={42} strokeWidth={1.15} className="assets-heading-icon" />
        <div className="assets-heading-copy">
          <h1>Библиотека ассетов</h1>
          <p className="subtitle">
            Модели, текстуры, анимации и другие ресурсы проекта. Ассет принадлежит проекту,
            а задачи используют его по необходимости.
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={importing}
            onClick={onImport}
          >
            <Plus size={15} />
            {importing ? "Импорт…" : "Импортировать ассет"}
          </button>
        </div>
      </div>

      <div className="resource-toolbar">
        <label className="resource-search">
          <Search size={14} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск ассетов…"
            aria-label="Поиск ассетов"
          />
        </label>
        <select
          className="filter-select"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
          aria-label="Тип ассета"
        >
          <option value="all">Все типы</option>
          {TYPE_ORDER.map((type) => (
            <option key={type} value={type}>
              {ASSET_TYPE_LABELS[type] ?? type}
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          value={engineFilter}
          onChange={(event) => setEngineFilter(event.target.value)}
          aria-label="Движок"
        >
          <option value="all">Все движки</option>
          {engines.map((engine) => (
            <option key={engine} value={engine}>
              {ENGINE_LABELS[engine as Engine]}
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          aria-label="Статус ассета"
        >
          <option value="all">Все статусы</option>
          {(["draft", "review", "accepted", "archived"] as AssetVersionStatus[]).map((status) => (
            <option key={status} value={status}>
              {ASSET_VERSION_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
          aria-label="Сортировка"
        >
          <option value="recent">Последние</option>
          <option value="name">По имени</option>
          <option value="size">По размеру</option>
        </select>
        <div className="view-toggle">
          <button
            type="button"
            className={view === "grid" ? "is-active" : ""}
            onClick={() => setView("grid")}
            aria-label="Сетка"
            title="Сетка"
          >
            <LayoutGrid size={15} />
          </button>
          <button
            type="button"
            className={view === "list" ? "is-active" : ""}
            onClick={() => setView("list")}
            aria-label="Список"
            title="Список"
          >
            <List size={15} />
          </button>
        </div>
      </div>

      {error ? <p className="modal-error resource-error">{error}</p> : null}

      {filtered.length === 0 ? (
        <div className="empty-panel">
          <div className="empty-art">
            <Box size={62} strokeWidth={1.05} />
            <Sparkles size={22} className="empty-sparkle" />
          </div>
          <h2 className="empty-title">
            {assets.length === 0 ? "Библиотека пока пуста" : "Ничего не найдено"}
          </h2>
          <p className="empty-text">
            {assets.length === 0
              ? "Импортируй первый ассет — Kova сохранит версии, проверки и происхождение."
              : "Попробуй другой запрос или сбрось фильтры."}
          </p>
          {assets.length === 0 ? (
            <button type="button" className="btn btn-primary" onClick={onImport}>
              <Plus size={15} />
              Импортировать ассет
            </button>
          ) : null}
          <div className="empty-footer">
            <span>
              <Info size={13} />
              Поддержка: .blend .glb .fbx .png .wav
            </span>
            <span className="empty-divider" />
            <span>
              <Lock size={13} />
              Все изменения сохраняются локально
            </span>
          </div>
        </div>
      ) : view === "list" ? (
        <div className="asset-table">
          <div className="asset-table-row is-head">
            <span>Ассет</span>
            <span>Тип</span>
            <span>Статус</span>
            <span>Размер</span>
            <span>Обновлён</span>
            <span>Задачи</span>
            <span />
          </div>
          {visible.map((asset) => {
            const current =
              asset.versions.find((item) => item.id === asset.current_version_id) ??
              asset.versions[asset.versions.length - 1];
            const Icon = typeIcon(asset.type);
            return (
              <div className="asset-table-row" key={asset.id} onClick={() => onOpenAsset(asset.id)}>
                <div className="asset-table-name">
                  <span className="asset-table-thumb">
                    {asset.preview ? (
                      <img
                        src={`${coreUrl(`/assets/${asset.id}/preview`)}?v=${encodeURIComponent(
                          asset.updated_at,
                        )}`}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <Icon size={17} strokeWidth={1.4} />
                    )}
                  </span>
                  <span>
                    <b>{asset.name}</b>
                    <small title={asset.path}>{asset.path}</small>
                  </span>
                </div>
                <span className="asset-table-muted">
                  {ASSET_TYPE_LABELS[asset.type] ?? asset.type}
                </span>
                <span>
                  {current ? (
                    <span className={`task-status is-${current.status}`}>
                      {ASSET_VERSION_STATUS_LABELS[current.status]}
                    </span>
                  ) : (
                    <span className="asset-table-muted">—</span>
                  )}
                </span>
                <span className="asset-table-muted">{formatBytes(asset.file_size)}</span>
                <span className="asset-table-muted">{formatDate(asset.updated_at)}</span>
                <span className="asset-table-muted">
                  {asset.task_ids.length > 0
                    ? `${asset.task_ids.length} ${plural(asset.task_ids.length, ["задача", "задачи", "задач"])}`
                    : "свободен"}
                </span>
                <span className="asset-table-actions">
                  <button
                    type="button"
                    className="tk-icon-btn"
                    title="Открыть ассет"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenAsset(asset.id);
                    }}
                  >
                    <ChevronRight size={14} />
                  </button>
                  <button
                    type="button"
                    className="tk-icon-btn is-danger"
                    title="Удалить ассет"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteAsset(asset.id);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
            );
          })}
          <div className="asset-table-foot">
            Показано {filtered.length} из {assets.length} ассетов
          </div>
        </div>
      ) : (
        <div className="asset-grid2">
          {visible.map((asset) => {
            const current =
              asset.versions.find((item) => item.id === asset.current_version_id) ??
              asset.versions[asset.versions.length - 1];
            const Icon = typeIcon(asset.type);
            return (
              <button
                type="button"
                className="asset-card2"
                key={asset.id}
                onClick={() => onOpenAsset(asset.id)}
              >
                <span className="asset-thumb2">
                  {asset.preview ? (
                    <img
                      src={`${coreUrl(`/assets/${asset.id}/preview`)}?v=${encodeURIComponent(
                        asset.updated_at,
                      )}`}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <Icon size={30} strokeWidth={1.35} />
                  )}
                </span>
                <span className="asset-card2-body">
                  <span className="asset-card2-head">
                    <b>{asset.name}</b>
                    <span className="asset-used">
                      {asset.task_ids.length > 0
                        ? `${asset.task_ids.length} ${plural(asset.task_ids.length, ["задача", "задачи", "задач"])}`
                        : "свободен"}
                    </span>
                  </span>
                  <span className="asset-type2">
                    {ASSET_TYPE_LABELS[asset.type] ?? asset.type}
                  </span>
                  <span className="asset-meta2">
                    {formatBytes(asset.file_size)} · {formatDate(asset.updated_at)}
                  </span>
                  {current ? (
                    <span className={`task-status is-${current.status}`}>
                      {ASSET_VERSION_STATUS_LABELS[current.status]}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {filtered.length > pageSize ? (
        <div className="asset-pagination">
          <span>
            Страница {page} из {pageCount} · {filtered.length} ассетов
          </span>
          <div className="asset-pagination-actions">
            <button
              type="button"
              className="btn btn-secondary btn-compact"
              disabled={page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              Назад
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-compact"
              disabled={page >= pageCount}
              onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
            >
              Вперёд
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
