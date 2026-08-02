# Components

Map of the UI components. Shared components live in `src/components/`; the
tree-canvas and sidebar UI live under `src/app/tree/[treeId]/`. Read this before
touching the UI.

## Shared components (`src/components/`)

| Component | Location | Responsibility |
|---|---|---|
| `PersonNode` | `src/components/PersonNode.tsx:66` | React Flow node for a person card. Avatar (photo or gender-colored initials), name, lifeline badge (age or birth–death), birthplace, and "also appears in" tree badges (cross-tree nav via `useMemberTrees`). The `Highlight bloodline` Appearance setting marks male founders and descendants reached through father-to-son links with a strong cobalt outline, marks other bloodline members in amber, and dims married-in spouses. When the person has a parent in another tree **and no parents in the current tree** (i.e. the current tree isn't their family — their ancestry lives elsewhere), an "ancestor family" pill (`useAncestorTree`) floats above the top edge, centered, linking up to that tree. The pill is absolutely positioned (stacks above the add-parent `+` button when both show) so the avatar — and thus the couple line at `COUPLE_LINE_Y` — never shifts. Hidden handles `t/l/r/b` (left/right pinned at `COUPLE_LINE_Y`). When editable, hover reveals +/link buttons for parent/spouse/child via `useTreeActions()`; respects `linkState` for click-to-connect highlighting. |
| `UnionNode` | `src/components/UnionNode.tsx:17` | The junction dot where a couple's line meets their children. Invisible handles `l/r/b`. 12px dot; hovering it shows the full marriage date, and when the "Marriage years" view setting is on the marriage year is shown inside the dot (a larger circle badge overlays it). Clicking the dot opens the sidebar editor for the couple's marriage date (`useViewSettings`, `useTreeActions`). |
| `HomePage` | `src/components/HomePage.tsx:178` | Landing/dashboard. Person search box (`usePersonSearch`) filtering every person in the store by name; clicking a result opens that person's earliest tree at `/tree/:treeId/p/:personId`. Create-tree form, "Create sample tree" (uses `seedData()`), grid of own `TreeCard`s (open/rename/share/delete with confirm) and `SharedTreeCard`s (read-only/editor badge + owner email). Loading/sign-in/empty states. |
| `ShareDialog` | `src/components/ShareDialog.tsx:11` | Owner modal for tree sharing (used by HomePage). Loads `/api/trees/:id/shares`, add email+role (viewer/editor), revoke; shows a "pending sign-in" badge when `userId === null`. Also lists pending `access-requests` (name/email + the requester's "who are you" note) with Approve (grants viewer) / Decline buttons. Esc/backdrop close. Backed by the shared `useShares` and `useOwnerAccessRequests` hooks. |
| `SharingPage` | `src/components/SharingPage.tsx:160` | Owner **page** at `/sharing` (linked from the HomePage "Sharing" button, shown when you own ≥1 tree) rendered as a **people × trees access matrix**. An "Invite someone" bar above the table adds a draft person; saved people and drafts are merged and sorted A→Z by display name (email fallback), so an access change does not move someone between separate sections. Each cell is a custom `RoleSelect` that shows just a colored icon when closed (pencil=editor/emerald, eye=viewer/cobalt, ban=none/slate) and opens a portal-rendered menu with icon + label (No access / Viewer / Editor) — portaled so it is never clipped by the table's scroll containers. Selecting grants, updates, or revokes via `useOwnerShares.setRole`. Tree columns use initial-avatar badges; person rows use a round avatar + name/email + a green/amber Active/Pending dot and an inline red trash to remove them (matching ShareDialog's revoke button); the first column is sticky. Removing uses the standard destructive confirmation and states how many tree permissions will be revoked. The active role cell and the remove button each show a spinner while their request is in flight (all controls disabled meanwhile). A legend above explains the icons and the status dots. Same sticky header as Home (logo + brand + `AccountMenu`) with a back link. Loads `/api/shares`. |
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
| `TreeView` | `_tree/TreeView.tsx:39` | Orchestrates React Flow. Manages sidebar state, click-to-connect (same cycle/eligibility rules as the sidebar), edge-click removal (with confirm), and delete-key handling (confirm "from ALL trees"). |

### Sidebar

| Component | Location | Responsibility |
|---|---|---|
| `Sidebar` | `_sidebar/Sidebar.tsx:30` | Switches between `AddForm`/`EditForm`/`EditPersonDetails`/`MarriagePanel`/`ReadonlyDetails`/`SharePanel`/idle/viewer-readonly states; wires Export/Import JSON. Footer's Share button is owner-only (`canShare`). |
| `AddForm` | `_sidebar/AddForm.tsx:15` | Form for adding a member given a `Relationship`. |
| `EditForm` | `_sidebar/EditForm.tsx:37` | Edit a person: spouses/parents/children, marriage date per spouse, cross-tree marriage, same-person merge. In the Parents section, when this tree has none of the person's parents, their ancestor-family parents (`useAncestorParents`) render as editable rows: details (via `EditPersonDetails`) and adopted status are edited as global facts without joining this tree. |
| `EditPersonDetails` | `_sidebar/EditPersonDetails.tsx:18` | Details-only editor for a person who isn't a member of this tree (e.g. an ancestor parent reached from another tree). Edits the shared global identity via `updatePerson`, so changes apply everywhere the person appears; relationship sections don't apply. |
| `MarriagePanel` | `_sidebar/MarriagePanel.tsx:11` | Focused editor for one couple's marriage date, opened by clicking a union dot (`TreeActions.editMarriage`). Date field only. |
| `PersonFields` | `_sidebar/PersonFields.tsx:28` | Reusable fields: name/gender/dates/birthplace/photo, with clipboard-paste crop. |
| `ReadonlyDetails` | `_sidebar/ReadonlyDetails.tsx:12` | Read-only person view (viewers / not editable). When the person has no parents in the current tree but does in their ancestor family (another tree), the Parents section shows those cross-tree parents (`useAncestorParents`, loaded on demand) as read-only chips — clicking one opens it in the ancestor tree. |
| `RelationList` | `_sidebar/RelationList.tsx:3` | Renders a relationship list section. |
| `SettingsPanel` | `_sidebar/SettingsPanel.tsx:7` | Tree/view settings (e.g. minimap toggle via `useViewSettings`). Also hosts the Data section: Export/Import JSON, and Export to PDF (fits the whole tree into a fixed page-sized box via `getNodesBounds` + `setViewport`, disables `onlyRenderVisibleElements`, then `window.print()`; print-only CSS in `globals.css` strips the chrome and sizes the canvas to the page). |
| `SharePanel` | `_sidebar/SharePanel.tsx:14` | Sidebar panel for owner tree sharing — invite by email + role (viewer/editor), revoke. Same functionality as `ShareDialog`, styled as a sidebar panel; uses the shared `useShares` hook. |
| `shared` | `_sidebar/shared.ts` | Shared form field types and helpers: `Fields`, `SidebarState`, `fieldsFrom` (`:27`), `toInput` (`:38`), plus shared class strings (`inputCls`, `labelCls`, `primaryBtn`, `ghostBtn`). |

## Context bridges (`src/lib/`)

- `TreeActionsContext` / `useTreeActions()` — `src/lib/tree-actions.ts`. Bridges the
  canvas and the sidebar. `TreeActions` (`:6`) exposes `openAdd(rel)`,
  `startLink(kind, sourceId)`, `editMarriage(a, b)`, and `readOnly`. `LinkKind`
  (`:4`) is `"spouse" | "parent" | "child"`.
- `useViewSettings()` — `src/lib/view-settings.ts:62`. Client-only, persisted view
  preferences (minimap, marriage-years toggle). See
  [state-and-sync.md](./state-and-sync.md).
- `useShares(treeId)` — `src/lib/shares.ts:20`. Loads and manages a tree's
  share list for its owner (load/add/remove against
  `/api/trees/:id/shares`); shared by `ShareDialog` (HomePage modal) and the
  sidebar `SharePanel`.
- `useOwnerShares()` / `addShareToTree(treeId, email, role)` —
  `src/lib/shares.ts`. The hook loads an owner's cross-tree sharing overview
  from `/api/shares` (people grouped by email, each with their trees + role),
  and exposes `setRole(email, treeId, role | null)` (grant/update, or revoke
  when `null`) used by the `SharingDialog` matrix. `addShareToTree` is the
  single-tree add the hook calls under the hood.
- `useAccessRequest(treeId)` / `useOwnerAccessRequests(treeId)` —
  `src/lib/access-requests.ts`. The requester side reads/creates their own
  access request against `/api/trees/:id/access-request`; the owner side lists
  and resolves pending requests (`/api/trees/:id/access-requests`) for the
  `ShareDialog`.
