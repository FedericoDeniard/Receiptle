import { useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronDown,
  Pencil,
  Plus,
  Tag as TagIcon,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "../ui/Button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { ConfirmModal } from "../ui/ConfirmModal";
import {
  TAG_COLOR_CLASSES,
  TAG_COLORS,
  DEFAULT_TAG_COLOR,
  type TagColor,
} from "../../constants/tags";
import { useTags } from "../../hooks/useTags";
import { useTagMutations } from "../../hooks/useTagMutations";
import { TagBadge } from "./TagBadge";
import type { Tag } from "../../types/tags";

const EMPTY_IDS: string[] = [];

interface TagSelectorProps {
  mode: "assign" | "manage";
  value?: string[];
  onChange?: (ids: string[]) => void;
  disabled?: boolean;
  className?: string;
  iconOnly?: boolean;
}

export function TagSelector({
  mode,
  value = EMPTY_IDS,
  onChange,
  disabled,
  className,
  iconOnly,
}: TagSelectorProps) {
  const { t } = useTranslation();
  const { data: tags = [], isLoading } = useTags();
  const { createTag, updateTag, deleteTag } = useTagMutations();

  if (mode === "manage") {
    return (
      <div className={cn("space-y-4", className)}>
        <ManageTagsList
          tags={tags}
          isLoading={isLoading}
          onCreate={createTag}
          onUpdate={updateTag}
          onDelete={deleteTag}
          t={t}
        />
      </div>
    );
  }

  return (
    <AssignTagSelector
      tags={tags}
      isLoading={isLoading}
      value={value}
      onChange={onChange}
      onCreate={createTag}
      disabled={disabled}
      className={className}
      iconOnly={iconOnly}
      t={t}
    />
  );
}

// ─── assign mode ──────────────────────────────────────────────────────────

interface AssignTagSelectorProps {
  tags: Tag[];
  isLoading: boolean;
  value: string[];
  onChange?: (ids: string[]) => void;
  onCreate: (input: { name: string; color: TagColor }) => Promise<Tag>;
  disabled?: boolean;
  className?: string;
  iconOnly?: boolean;
  t: TFunction;
  id?: string;
}

function AssignTagSelector({
  tags,
  isLoading,
  value,
  onChange,
  onCreate,
  disabled,
  className,
  iconOnly,
  t,
  id,
}: AssignTagSelectorProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const selected = useMemo(
    () =>
      value
        .map(id => tags.find(tag => tag.id === id))
        .filter((t): t is Tag => !!t),
    [value, tags]
  );

  const selectedIds = useMemo(() => new Set(value), [value]);

  const toggle = (id: string) => {
    if (!onChange) return;
    if (value.includes(id)) {
      onChange(value.filter(v => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  return (
    <div
      className={cn(
        iconOnly ? "flex items-center gap-2 flex-wrap" : "space-y-2",
        className
      )}
    >
      {!iconOnly && selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(tag => (
            <TagBadge
              key={tag.id}
              name={tag.name}
              color={tag.color}
              onRemove={disabled ? undefined : () => toggle(tag.id)}
            />
          ))}
        </div>
      )}

      {iconOnly && selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 justify-end flex-1 min-w-0">
          {selected.map(tag => (
            <TagBadge
              key={tag.id}
              name={tag.name}
              color={tag.color}
              onRemove={disabled ? undefined : () => toggle(tag.id)}
            />
          ))}
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={iconOnly ? "secondary" : "outline"}
            size="sm"
            disabled={disabled || isLoading}
            id={id}
            icon={<Plus size={iconOnly ? 16 : 14} />}
            className={cn(
              iconOnly
                ? "size-7 !p-0 rounded-full !text-[var(--primary)] shrink-0"
                : "h-8 text-xs"
            )}
            aria-label={t("tags.selectTags", "Add tags")}
            title={t("tags.selectTags", "Add tags")}
          >
            {!iconOnly && t("tags.selectTags", "Add tags")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          {creating ? (
            <CreateTagInline
              onCancel={() => setCreating(false)}
              onSubmit={async input => {
                const created = await onCreate(input);
                onChange?.([...value, created.id]);
                setCreating(false);
              }}
              t={t}
            />
          ) : (
            <div className="space-y-1">
              {tags.length === 0 ? (
                <p className="text-xs text-[var(--text-secondary)] py-3 text-center">
                  {t("tags.noTags", "No tags yet")}
                </p>
              ) : (
                <div className="max-h-56 overflow-y-auto space-y-0.5">
                  {tags.map(tag => {
                    const isSelected = selectedIds.has(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggle(tag.id)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm hover:bg-[var(--bg-secondary)]"
                      >
                        <Check
                          size={14}
                          className={cn(
                            "shrink-0",
                            isSelected ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <TagBadge name={tag.name} color={tag.color} />
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="border-t border-[var(--text-secondary)]/15 pt-1 mt-1">
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                >
                  <Plus size={14} />
                  {t("tags.addNewTag", "Create new tag")}
                </button>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function CreateTagInline({
  onSubmit,
  onCancel,
  t,
}: {
  onSubmit: (input: { name: string; color: TagColor }) => Promise<void>;
  onCancel: () => void;
  t: TFunction;
}) {
  const [color, setColor] = useState<TagColor>(DEFAULT_TAG_COLOR);
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    const name = nameRef.current?.value.trim() ?? "";
    if (!name || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({ name, color });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2 p-1">
      <input
        ref={nameRef}
        type="text"
        placeholder={t("tags.namePlaceholder", "Tag name")}
        aria-label={t("tags.namePlaceholder", "Tag name")}
        maxLength={50}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") handleSubmit();
        }}
        className="w-full px-3 py-2 rounded-lg border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] text-sm focus:outline-none focus:border-[var(--primary)]"
      />
      <div
        className="flex flex-wrap gap-1.5"
        role="radiogroup"
        aria-label={t("tags.color", "Color")}
      >
        {TAG_COLORS.map(c => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={`Color ${c}`}
            onClick={() => setColor(c)}
            className={cn(
              "size-6 rounded-full border",
              TAG_COLOR_CLASSES[c].bg,
              TAG_COLOR_CLASSES[c].border,
              color === c && `ring-2 ring-offset-1 ${TAG_COLOR_CLASSES[c].ring}`
            )}
          />
        ))}
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={submitting}
          loading={submitting}
          onClick={handleSubmit}
        >
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

// ─── manage mode ──────────────────────────────────────────────────────────

interface ManageTagsListProps {
  tags: Tag[];
  isLoading: boolean;
  onCreate: (input: { name: string; color: TagColor }) => Promise<Tag>;
  onUpdate: (input: {
    id: string;
    name?: string;
    color?: TagColor;
  }) => Promise<Tag>;
  onDelete: (id: string) => Promise<string>;
  t: TFunction;
}

function ManageTagsList({
  tags,
  isLoading,
  onCreate,
  onUpdate,
  onDelete,
  t,
}: ManageTagsListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <p className="text-sm text-[var(--text-secondary)]">
        {t("common.loading")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {tags.length === 0 && (
          <p className="text-sm text-[var(--text-secondary)]">
            {t("tags.noTags", "No tags yet")}
          </p>
        )}
        {tags.map(tag =>
          editingId === tag.id ? (
            <EditTagRow
              key={tag.id}
              tag={tag}
              onSave={async input => {
                await onUpdate({ id: tag.id, ...input });
                setEditingId(null);
              }}
              onCancel={() => setEditingId(null)}
              t={t}
            />
          ) : (
            <div
              key={tag.id}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-[var(--text-secondary)]/15 bg-[var(--bg-primary)]"
            >
              <TagBadge name={tag.name} color={tag.color} size="md" />
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={<Pencil size={14} />}
                  onClick={() => setEditingId(tag.id)}
                  aria-label={t("tags.editTag")}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 size={14} />}
                  onClick={() => setPendingDeleteId(tag.id)}
                  className="text-rose-600 hover:bg-rose-50"
                  aria-label={t("tags.deleteTag")}
                />
              </div>
            </div>
          )
        )}
      </div>

      <CreateTagRow onCreate={onCreate} t={t} />

      <ConfirmModal
        isOpen={!!pendingDeleteId}
        onClose={() => setPendingDeleteId(null)}
        onConfirm={async () => {
          if (pendingDeleteId) await onDelete(pendingDeleteId);
          setPendingDeleteId(null);
        }}
        title={t("tags.deleteTag", "Delete tag")}
        message={
          pendingDeleteId
            ? t("tags.confirmDelete", {
                name: tags.find(tg => tg.id === pendingDeleteId)?.name ?? "",
              })
            : ""
        }
        confirmText={t("common.delete")}
        isDestructive
      />
    </div>
  );
}

function CreateTagRow({
  onCreate,
  t,
}: {
  onCreate: (input: { name: string; color: TagColor }) => Promise<Tag>;
  t: TFunction;
}) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState<TagColor>(DEFAULT_TAG_COLOR);
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    if (nameRef.current) nameRef.current.value = "";
    setColor(DEFAULT_TAG_COLOR);
  };

  const handleSubmit = async () => {
    const name = nameRef.current?.value.trim() ?? "";
    if (!name || submitting) return;
    setSubmitting(true);
    try {
      await onCreate({ name, color });
      reset();
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        icon={<Plus size={14} />}
        onClick={() => setOpen(true)}
      >
        {t("tags.createTag", "New tag")}
      </Button>
    );
  }

  return (
    <div className="p-3 rounded-lg border border-[var(--text-secondary)]/15 bg-[var(--bg-secondary)] space-y-3">
      <div className="flex items-center gap-2">
        <TagIcon size={14} className="text-[var(--text-secondary)] shrink-0" />
        <input
          ref={nameRef}
          type="text"
          placeholder={t("tags.namePlaceholder", "Tag name")}
          aria-label={t("tags.namePlaceholder", "Tag name")}
          maxLength={50}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") handleSubmit();
          }}
          className="flex-1 px-3 py-2 rounded-lg border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] text-sm focus:outline-none focus:border-[var(--primary)]"
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-[var(--text-secondary)] shrink-0">
          {t("tags.color", "Color")}
        </span>
        <div
          role="radiogroup"
          aria-label={t("tags.color", "Color")}
          className="flex flex-wrap gap-1.5"
        >
          {TAG_COLORS.map(c => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`Color ${c}`}
              onClick={() => setColor(c)}
              className={cn(
                "size-6 rounded-full border",
                TAG_COLOR_CLASSES[c].bg,
                TAG_COLOR_CLASSES[c].border,
                color === c &&
                  `ring-2 ring-offset-1 ${TAG_COLOR_CLASSES[c].ring}`
              )}
            />
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            reset();
          }}
        >
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={submitting}
          onClick={handleSubmit}
        >
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

function EditTagRow({
  tag,
  onSave,
  onCancel,
  t,
}: {
  tag: Tag;
  onSave: (input: { name?: string; color?: TagColor }) => Promise<void>;
  onCancel: () => void;
  t: TFunction;
}) {
  // Parent renders this with `key={tag.id}`, so the form remounts when the
  // user clicks Edit on a different row. `defaultValue` + `defaultChecked`
  // therefore always reflect the right tag, no useState copy needed.
  // The color selection uses real native radios so the value flows back
  // through the element's `value` getter instead of being mirrored into
  // component state.
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleSubmit = async () => {
    if (submitting) return;
    const name = nameRef.current?.value.trim() ?? "";
    const selected = containerRef.current?.querySelector<HTMLInputElement>(
      'input[name="color"]:checked'
    );
    const color = selected?.value as TagColor | undefined;
    const nameOk = !!name && name === tag.name ? tag.name : name;
    const colorOk = color && color === tag.color ? tag.color : color;

    setSubmitting(true);
    try {
      const updates: { name?: string; color?: TagColor } = {};
      if (nameOk && nameOk !== tag.name) updates.name = nameOk;
      if (colorOk && colorOk !== tag.color) updates.color = colorOk;
      if (Object.keys(updates).length > 0) await onSave(updates);
      else onCancel();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="p-3 rounded-lg border border-[var(--text-secondary)]/15 bg-[var(--bg-secondary)] space-y-3"
    >
      <input
        ref={nameRef}
        type="text"
        defaultValue={tag.name}
        aria-label={t("tags.name", "Name")}
        maxLength={50}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") handleSubmit();
        }}
        className="w-full px-3 py-2 rounded-lg border border-[var(--text-secondary)]/20 bg-[var(--bg-primary)] text-sm focus:outline-none focus:border-[var(--primary)]"
      />
      <div className="flex items-center gap-3">
        <span className="text-xs text-[var(--text-secondary)] shrink-0">
          {t("tags.color", "Color")}
        </span>
        <div
          role="radiogroup"
          aria-label={t("tags.color", "Color")}
          className="flex flex-wrap gap-1.5"
        >
          {TAG_COLORS.map(c => (
            <label
              key={c}
              aria-label={`Color ${c}`}
              className="inline-block cursor-pointer"
            >
              <input
                type="radio"
                name="color"
                value={c}
                defaultChecked={c === tag.color}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className={cn(
                  "block size-6 rounded-full border transition-shadow",
                  TAG_COLOR_CLASSES[c].bg,
                  TAG_COLOR_CLASSES[c].border,
                  `peer-checked:ring-2 peer-checked:ring-offset-1 peer-focus-visible:ring-2 peer-focus-visible:ring-offset-1 ${TAG_COLOR_CLASSES[c].ring}`
                )}
              />
            </label>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={submitting}
          onClick={handleSubmit}
        >
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
