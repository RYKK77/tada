import type { List, Task, ProjectGoal, ExportedData, ImportOptions, ConflictResolution, DataConflict } from '../types';

export function normalizeProject(list: List): List {
    if (list.name === 'Inbox') return list;
    return { summary: '', description: '', status: 'active', targetDate: null, archivedAt: null, ...list };
}

export function isArchivedTask(task: Task, lists: List[]): boolean {
    return lists.some(list => list.id === task.listId && !!list.archivedAt);
}

export type UrgencyReason = 'overdue' | 'today' | 'manual' | 'soon';
export function urgencyReasons(task: Task, now = new Date()): UrgencyReason[] {
    if (task.completed || task.listName === 'Trash') return [];
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(today);
    end.setDate(end.getDate() + 4); // Through the end of the next three local calendar days.
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const reasons: UrgencyReason[] = [];
    if (task.dueDate != null && Number.isFinite(task.dueDate)) {
        if (task.dueDate < today.getTime()) reasons.push('overdue');
        else if (task.dueDate < tomorrow.getTime()) reasons.push('today');
    }
    if (task.urgent) reasons.push('manual');
    if (task.dueDate != null && task.dueDate >= tomorrow.getTime() && task.dueDate < end.getTime()) reasons.push('soon');
    return reasons;
}

export function urgentTasks(tasks: Task[], now = new Date()): Task[] {
    const rank: Record<UrgencyReason, number> = { overdue: 0, today: 1, manual: 2, soon: 3 };
    return tasks.filter(task => urgencyReasons(task, now).length).sort((a, b) =>
        rank[urgencyReasons(a, now)[0]] - rank[urgencyReasons(b, now)[0]] ||
        (a.priority || 4) - (b.priority || 4) ||
        (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity) || a.order - b.order);
}

export function goalTasks(goal: ProjectGoal, goals: ProjectGoal[], tasks: Task[]): Task[] {
    const ids = new Set([goal.id, ...goals.filter(g => g.parentId === goal.id).map(g => g.id)]);
    return tasks.filter(task => task.listId === goal.projectId && task.listName !== 'Trash' && !!task.goalId && ids.has(task.goalId));
}

// Resolve legacy name-only assignments and remove references that cross project boundaries.
export function normalizeTaskProject(task: Task, lists: List[], goals: ProjectGoal[]): Task {
    const assigned = lists.find(list => list.id === task.listId) ?? lists.find(list => list.name === task.listName);
    if (!assigned && task.listName === 'Trash') return { ...task, listId: null, goalId: null };
    const project = assigned ?? lists.find(list => list.name === 'Inbox');
    const goal = goals.find(item => item.id === task.goalId && item.projectId === project?.id);
    return { ...task, listId: project?.id ?? null, listName: task.listName === 'Trash' ? 'Trash' : project?.name ?? 'Inbox', goalId: goal?.id ?? null };
}

export function taskProjectUpdates(task: Task, updates: Partial<Task>, lists: List[], goals: ProjectGoal[]): Partial<Task> {
    const next = { ...task, ...updates };
    if (updates.listName && updates.listName !== 'Trash' && updates.listName !== task.listName && updates.listId === undefined) {
        next.listId = lists.find(list => list.name === updates.listName)?.id ?? null;
    }
    const normalized = normalizeTaskProject(next, lists, goals);
    return { ...updates, listId: normalized.listId, listName: normalized.listName, goalId: normalized.goalId };
}

export function normalizeGoals(goals: ProjectGoal[], lists: List[]): ProjectGoal[] {
    const projects = new Set(lists.filter(list => list.name !== 'Inbox').map(list => list.id));
    const valid = [...new Map(goals.filter(goal => projects.has(goal.projectId)).map(goal => [goal.id, goal])).values()];
    return valid.map(goal => ({ ...goal, parentId: goal.kind === 'short' && valid.some(parent => parent.id === goal.parentId && parent.kind === 'long' && parent.projectId === goal.projectId) ? goal.parentId : null }));
}

export function goalImportConflicts(local: ProjectGoal[], data: ExportedData, options: ImportOptions): DataConflict[] {
    if (!options.includeLists) return [];
    return (data.data.goals ?? []).flatMap(imported => {
        const existing = local.find(goal => goal.id === imported.id);
        return existing ? [{ id: imported.id, type: 'goal' as const, local: existing, imported }] : [];
    });
}

export function mergeImportedGoals(local: ProjectGoal[], data: ExportedData, options: ImportOptions, lists: List[], resolutions?: Map<string, ConflictResolution>): ProjectGoal[] {
    if (!options.includeLists) return normalizeGoals(local, lists);
    const merged = new Map((options.replaceAllData ? [] : local).map(goal => [goal.id, goal]));
    for (const imported of data.data.goals ?? []) {
        const existing = merged.get(imported.id);
        const resolution = resolutions?.get(imported.id) ?? options.conflictResolution;
        if (!existing || resolution === 'keep-imported' || (resolution === 'keep-newer' && imported.updatedAt > existing.updatedAt)) merged.set(imported.id, imported);
    }
    return normalizeGoals([...merged.values()], lists);
}

export function assertProjectCompletion(list: List, tasks: Task[]): void {
    if (list.status === 'completed' && tasks.some(task => task.listId === list.id && !task.completed && task.listName !== 'Trash')) {
        throw new Error('projectHasOpenTasks');
    }
}

export function dateInput(value?: number | null): string {
    if (value == null || !Number.isFinite(value)) return '';
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
