# Components

Map of the UI components. Shared components live in `src/components/`; the
tree-canvas and sidebar UI live under `src/app/tree/[treeId]/`. Read this before
touching the UI.

## Shared components (`src/components/`)

| Component | Location | Responsibility |
|---|---|---|
| `PersonNode` | `src/components/PersonNode.tsx:62` | React Flow node for a person card. Avatar (photo or gender-colored initials), name, lifeline badge (age or birth–death), location, and "also appears in" tree badges (cross-tree nav via `useMemberTrees`). Hidden handles `t/l/r/b` (left/right pinned at `COUPLE_LINE_Y`). When editable, hover reveals +/link buttons for parent/spouse/child via `useTreeActions()`; respects `linkState` for click-to-connect highlighting. |
| `UnionNode` | `src/components/UnionNode.tsx:6` | The junction dot where a couple's line meets their children. Invisible handles `l/r/b`. Renderless-ish 12px dot. |
| `HomePage` | `src/components/HomePage.tsx:178` | Landing/dashboard. Create-tree form, "Create sample tree" (uses `seedData()`), grid of own `TreeCard`s (open/rename/share/delete with confirm) and `SharedTreeCard`s (read-only/editor badge + owner email). Loading/sign-in/empty states. |
| `ShareDialog` | `src/components/ShareDialog.tsx:17` | Owner modal for tree sharing. Loads `/api/trees/:id/shares`, add email+role (viewer/editor), revoke; shows a "pending sign-in" badge when `userId === null`. Esc/backdrop close. |
| `AccountMenu` | `src/components/AccountMenu.tsx:9` | Sign-in-with-Google button when signed out; avatar dropdown (name/email, sign-out) when in. Outside-click dismiss. |
| `AvatarCropper` | `src/components/AvatarCropper.tsx:24` | Portal-rendered photo cropper. Drag-to-pan + wheel/slider zoom, circular overlay, Esc to cancel; on confirm calls `cropToAvatar` (`src/lib/image.ts:23`). Rendered via `createPortal(document.body)` to escape nested forms and transformed parents. |
| `Toast` | `src/components/Toast.tsx` | Context-based toasts. `useToast()` (`:16`) returns a function `(message, tone?)`; tones are info/success/error; auto-dismiss ~4.5s. Provided by `ToastProvider` (`:35`). |
| `Confirm` | `src/components/Confirm.tsx` | Promise-based confirm dialog. `useConfirm()` (`:25`) returns `() => Promise<boolean>`; danger/default tones; Enter=confirm, Esc=cancel, backdrop dismiss. Provided by `ConfirmProvider` (`:31`). |
| `Section` | `src/components/Section.tsx:11` | Collapsible `<details open>` panel with icon, title, and count badge. Used by sidebar relationship lists. |

## Tree canvas & sidebar (`src/app/tree/[treeId]/`)

Private folders are prefixed `_` so Next.js excludes them from routing.

### Canvas

| Component | Location | Responsibility |
|---|---|---|
| `TreeView` | `_tree/TreeView.tsx:39` | Orchestrates React Flow. Manages sidebar state, focus view, click-to-connect (same cycle/eligibility rules as the sidebar), edge-click removal (with confirm), and delete-key handling (confirm "from ALL trees"). |

### Sidebar

| Component | Location | Responsibility |
|---|---|---|
| `Sidebar` | `_sidebar/Sidebar.tsx:30` | Switches between `AddForm`/`EditForm`/`ReadonlyDetails`/idle/viewer-readonly states; wires Export/Import JSON. |
| `AddForm` | `_sidebar/AddForm.tsx:15` | Form for adding a member given a `Relationship`. |
| `EditForm` | `_sidebar/EditForm.tsx:37` | Edit a person: spouses/parents/children, cross-tree marriage, same-person merge. |
| `PersonFields` | `_sidebar/PersonFields.tsx:28` | Reusable fields: name/gender/dates/location/photo, with clipboard-paste crop. |
| `ReadonlyDetails` | `_sidebar/ReadonlyDetails.tsx:12` | Read-only person view (viewers / not editable). |
| `RelationList` | `_sidebar/RelationList.tsx:3` | Renders a relationship list section. |
| `SettingsPanel` | `_sidebar/SettingsPanel.tsx:7` | Tree/view settings (e.g. minimap toggle via `useViewSettings`). |
| `shared` | `_sidebar/shared.ts` | Shared form field types and helpers: `Fields`, `SidebarState`, `fieldsFrom` (`:27`), `toInput` (`:38`), plus shared class strings (`inputCls`, `labelCls`, `primaryBtn`, `ghostBtn`). |

## Context bridges (`src/lib/`)

- `TreeActionsContext` / `useTreeActions()` — `src/lib/tree-actions.ts`. Bridges the
  canvas and the sidebar. `TreeActions` (`:6`) exposes `openAdd(rel)`,
  `startLink(kind, sourceId)`, and `readOnly`. `LinkKind` (`:4`) is
  `"spouse" | "parent" | "child"`.
- `useViewSettings()` — `src/lib/view-settings.ts:46`. Client-only, persisted view
  preferences (currently the minimap toggle). See
  [state-and-sync.md](./state-and-sync.md).
