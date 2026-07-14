import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, Network, Pencil, Plus, Sparkles, Trash2, Users } from "lucide-react";
import { countMembers, seedData, type TreeIndexStore, type TreeMeta } from "../store";

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const primaryBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50";

function TreeCard({ tree, navigate, onRename, onDelete }: {
  tree: TreeMeta;
  navigate: (to: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
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
    <div className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow-md">
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
          className="text-left text-base font-semibold text-slate-800 transition-colors hover:text-indigo-600"
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
          className="inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium text-slate-500 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          title="Delete tree"
          onClick={() => {
            if (confirm(`Delete "${tree.name}" and its ${members} members? This cannot be undone.`)) {
              onDelete();
            }
          }}
          className="inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium text-red-500 ring-1 ring-red-200 transition-colors hover:bg-red-50"
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
    <div className="min-h-screen w-full bg-slate-50">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <header className="mb-8 flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
            <Network className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Family Trees</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Create a new family tree or open an existing one.
            </p>
          </div>
        </header>

        <form
          onSubmit={handleCreate}
          className="mb-10 flex gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
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
          <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center">
            <span className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <Network className="h-6 w-6" />
            </span>
            <p className="text-sm text-slate-500">No family trees yet.</p>
            <p className="mt-1 text-xs text-slate-400">
              Create one above, or start from a small example to see how it works.
            </p>
            <button
              onClick={() => navigate(`/tree/${createTree("Sample Family", seedData())}`)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-medium text-indigo-600 ring-1 ring-indigo-200 transition-colors hover:bg-indigo-50"
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
