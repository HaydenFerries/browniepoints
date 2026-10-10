import { useEffect, useState, type ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

/**
 * A vertical list you can reorder by dragging each item's handle (touch, mouse
 * or keyboard: focus the handle, Space, arrows, Space). `render` gets the
 * handle to place inside the item.
 */
export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  render,
}: {
  items: T[];
  onReorder: (ids: string[]) => void;
  render: (item: T, handle: ReactNode) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Keep the dropped order on screen while the save round-trips.
  const key = items.map((i) => i.id).join(',');
  const [ids, setIds] = useState(() => items.map((i) => i.id));
  useEffect(() => setIds(items.map((i) => i.id)), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = new Map(items.map((i) => [i.id, i]));
  const ordered = ids.map((id) => byId.get(id)).filter((x): x is T => !!x);

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setIds(next);
    onReorder(next);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="stack-sm">
          {ordered.map((item) => (
            <SortableRow key={item.id} id={item.id}>
              {(handle) => render(item, handle)}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ id, children }: { id: string; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const handle = (
    <button ref={setActivatorNodeRef} type="button" className="drag-handle" aria-label="Drag to reorder" {...attributes} {...listeners}>
      <GripVertical size={18} />
    </button>
  );
  return (
    <div
      ref={setNodeRef}
      className={`sortable-row ${isDragging ? 'is-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {children(handle)}
    </div>
  );
}
