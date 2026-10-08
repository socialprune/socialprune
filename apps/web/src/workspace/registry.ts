import { openDB } from 'idb';

export interface RegistryEntry {
  id: string;
  kind: 'personal' | 'demo';
  createdAt: string;
}
async function database() {
  return openDB('sp-registry', 1, {
    upgrade(db) {
      db.createObjectStore('workspaces', { keyPath: 'id' });
      db.createObjectStore('pointers');
    },
  });
}
export async function activeWorkspace(): Promise<string | null> {
  const db = await database();
  try {
    return ((await db.get('pointers', 'active')) as string | undefined) ?? null;
  } finally {
    db.close();
  }
}
export async function publishWorkspace(entry: RegistryEntry): Promise<void> {
  const db = await database();
  try {
    const tx = db.transaction(['workspaces', 'pointers'], 'readwrite', {
      durability: 'strict',
    });
    await tx.objectStore('workspaces').put(entry);
    // The bundled demo never replaces the person's active review pointer.
    if (entry.id !== 'demo')
      await tx.objectStore('pointers').put(entry.id, 'active');
    await tx.done;
  } finally {
    db.close();
  }
}
export async function removeWorkspace(id: string): Promise<void> {
  const db = await database();
  try {
    const tx = db.transaction(['workspaces', 'pointers'], 'readwrite', {
      durability: 'strict',
    });
    await tx.objectStore('workspaces').delete(id);
    if ((await tx.objectStore('pointers').get('active')) === id)
      await tx.objectStore('pointers').delete('active');
    await tx.done;
  } finally {
    db.close();
  }
}
