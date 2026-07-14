import { useState, type FormEvent } from "react";
import { countMembers, seedData, type TreeIndexStore, type TreeMeta } from "../store";

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const primaryBtn =
  "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50";

function openTree(id: string) {
  window.location.hash = `#/tree/${id}`;
}

function TreeCard({ tree, onRename, onDelete }: {
  tree: TreeMeta;
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
          onClick={() => openTree(tree.id)}
          className="text-left text-base font-semibold text-slate-800 hover:text-indigo-600"
        >
          {tree.name}
        </button>
      )}

      <p className="mt-1 text-xs text-slate-400">
        {members} {members === 1 ? "member" : "members"} · created {created}
      </p>

      <div className="mt-4 flex items-center gap-2">
        <button onClick={() => openTree(tree.id)} className={`${primaryBtn} flex-1`}>
          Open
        </button>
        <button
          title="Rename tree"
          onClick={() => {
            setName(tree.name);
            setRenaming(true);
          }}
          className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50"
        >
          Rename
        </button>
        <button
          title="Delete tree"
          onClick={() => {
            if (confirm(`Delete "${tree.name}" and its ${members} members? This cannot be undone.`)) {
              onDelete();
            }
          }}
          className="rounded-lg px-3 py-2 text-sm font-medium text-red-500 ring-1 ring-red-200 hover:bg-red-50"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export function HomePage({ index }: { index: TreeIndexStore }) {
  const { trees, createTree, renameTree, deleteTree } = index;
  const [name, setName] = useState("");

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setName("");
    openTree(createTree(trimmed));
  }

  return (
    <div className="min-h-screen w-full bg-slate-50">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-slate-800">Family Trees</h1>
          <p className="mt-1 text-sm text-slate-500">
            Create a new family tree or open an existing one.
          </p>
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
            + Create tree
          </button>
        </form>

        {trees.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center">
            <p className="text-sm text-slate-500">No family trees yet.</p>
            <p className="mt-1 text-xs text-slate-400">
              Create one above, or start from a small example to see how it works.
            </p>
            <button
              onClick={() => openTree(createTree("Sample Family", seedData()))}
              className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-medium text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50"
            >
              Create sample tree
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {trees.map(tree => (
              <TreeCard
                key={tree.id}
                tree={tree}
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
