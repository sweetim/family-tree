import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, Network, Pencil, Plus, Sparkles, Trash2, Users } from "lucide-react";
import { useConfirm } from "./Confirm";
import { countMembers, seedData, type TreeIndexStore, type TreeMeta } from "../store";

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-slate-400 focus:border-cobalt-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-cobalt-200";
const primaryBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-xl bg-cobalt-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition-all hover:bg-cobalt-700 active:scale-95 disabled:pointer-events-none disabled:opacity-50";

function TreeCard({ tree, navigate, onRename, onDelete }: {
  tree: TreeMeta;
  navigate: (to: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const confirm = useConfirm();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(tree.name);
  const members = countMembers(tree.id);
  const created = new Date(tree.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  function submitRename(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed && trimmed !== tree.name) onRename(trimmed);
    setRenaming(false);
  }

  return (
    <div className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-soft transition-all duration-200 hover:-translate-y-1 hover:border-cobalt-200 hover:shadow-lift">
      {renaming ? (
        <form onSubmit={submitRename} className="flex gap-2">
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={submitRename}
            className={inputCls}
          />
        </form>
      ) : (
        <button
          onClick={() => navigate(`/tree/${tree.id}`)}
          className="text-left text-base font-semibold tracking-tight text-slate-800 transition-colors hover:text-cobalt-700"
        >
          {tree.name}
        </button>
      )}

      <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400">
        <Users className="h-3.5 w-3.5" />
        {members} {members === 1 ? "member" : "members"} · created {created}
      </p>

      <div className="mt-4 flex items-center gap-2">
        <button onClick={() => navigate(`/tree/${tree.id}`)} className={`${primaryBtn} flex-1`}>
          Open <ArrowRight className="h-4 w-4" />
        </button>
        <button
          title="Rename tree"
          onClick={() => {
            setName(tree.name);
            setRenaming(true);
          }}
          className="inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium text-slate-500 ring-1 ring-slate-200 transition-all hover:bg-slate-50 active:scale-95"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          title="Delete tree"
          onClick={async () => {
            if (
              await confirm({
                title: "Delete tree",
                message: `Delete "${tree.name}" and its ${members} members? This cannot be undone.`,
                confirmText: "Delete",
                tone: "danger",
              })
            ) {
              onDelete();
            }
          }}
          className="inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium text-red-500 ring-1 ring-red-200 transition-all hover:bg-red-50 active:scale-95"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function HomePage({ index }: { index: TreeIndexStore }) {
  const { trees, createTree, renameTree, deleteTree } = index;
  const [name, setName] = useState("");
  const navigate = useNavigate();

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setName("");
    navigate(`/tree/${createTree(trimmed)}`);
  }

  return (
    <div className="app-bg min-h-screen w-full">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <header className="mb-8 flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-cobalt-600 text-white shadow-soft">
            <Network className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-800">Family Trees</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Create a new family tree or open an existing one.
            </p>
          </div>
        </header>

        <form
          onSubmit={handleCreate}
          className="mb-10 flex gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-soft"
        >
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. The Tan Family"
            className={inputCls}
          />
          <button type="submit" disabled={!name.trim()} className={`${primaryBtn} shrink-0`}>
            <Plus className="h-4 w-4" /> Create tree
          </button>
        </form>

        {trees.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-10 text-center shadow-soft">
            <span className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <Network className="h-6 w-6" />
            </span>
            <p className="text-sm font-medium text-slate-600">No family trees yet.</p>
            <p className="mt-1 text-xs text-slate-400">
              Create one above, or start from a small example to see how it works.
            </p>
            <button
              onClick={() => navigate(`/tree/${createTree("Sample Family", seedData())}`)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-medium text-cobalt-600 shadow-soft ring-1 ring-cobalt-200 transition-all hover:bg-cobalt-50 active:scale-95"
            >
              <Sparkles className="h-4 w-4" /> Create sample tree
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {trees.map(tree => (
              <TreeCard
                key={tree.id}
                tree={tree}
                navigate={navigate}
                onRename={n => renameTree(tree.id, n)}
                onDelete={() => deleteTree(tree.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
