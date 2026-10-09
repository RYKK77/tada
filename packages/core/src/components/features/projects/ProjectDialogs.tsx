import { dateInput } from '@/services/projects';
import { useState, type ReactNode, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import { userListsAtom } from '@/store/lists';
import { useListOperations } from '@/hooks/useListOperations';
import { useProjectGoals } from '@/hooks/useProjectGoals';
import { useTaskOperations } from '@/hooks/useTaskOperations';
import CodeMirrorEditor from '@/components/ui/Editor';
import type { List, ProjectGoal, Task } from '@/types';

function dateValue(value: string): number | null { return value ? new Date(`${value}T00:00:00`).getTime() : null; }

export function ProjectDialog({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: ReactNode }) {
    return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
        <Dialog.Portal><Dialog.Overlay className="project-modal-overlay" /><Dialog.Content className="project-modal">
            <Dialog.Title>{title}</Dialog.Title><Dialog.Description className="project-modal-description">{description}</Dialog.Description>
            {children}
        </Dialog.Content></Dialog.Portal>
    </Dialog.Root>;
}

export function ProjectEditor({ project, onClose, onCreated }: { project?: List; onClose: () => void; onCreated?: (id: string) => void }) {
    const { t } = useTranslation();
    const lists = useAtomValue(userListsAtom) ?? [];
    const { createList, updateList } = useListOperations();
    const [draft, setDraft] = useState({ name: project?.name ?? '', summary: project?.summary ?? '', description: project?.description ?? '', targetDate: dateInput(project?.targetDate) });
    const [error, setError] = useState('');
    function submit(event: FormEvent) {
        event.preventDefault();
        const name = draft.name.trim();
        if (!name) return;
        if (['inbox','trash','archive','all','today','next 7 days','completed','later','nodate','overdue'].includes(name.toLowerCase()) || lists.some(list => list.id !== project?.id && list.name.toLowerCase() === name.toLowerCase())) { setError(t('projects.nameConflict')); return; }
        try {
            const updates = { name, summary: draft.summary.trim(), description: draft.description, targetDate: dateValue(draft.targetDate) };
            if (project) updateList(project.id, updates);
            else { const created = createList({ name }); updateList(created.id, updates); onCreated?.(created.id); }
            onClose();
        } catch { setError(t('projects.saveError')); }
    }
    return <ProjectDialog title={t(project ? 'projects.editProject' : 'projects.newProject')} description={t(project ? 'projects.overviewHint' : 'projects.createHint')} onClose={onClose}>
        <form onSubmit={submit}>
            <label className="project-field">{t('projects.name')}<input className="project-input" required autoFocus maxLength={120} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
            <label className="project-field">{t('projects.summary')}<input className="project-input" maxLength={280} value={draft.summary} placeholder={t('projects.summaryPlaceholder')} onChange={event => setDraft({ ...draft, summary: event.target.value })} /></label>
            {project && <><label className="project-field">{t('projects.targetDate')}<input type="date" className="project-input" value={draft.targetDate} onChange={event => setDraft({ ...draft, targetDate: event.target.value })} /></label>
                <div className="project-field"><span>{t('projects.description')}</span><div className="h-64 border border-grey-light/60 dark:border-neutral-700 rounded-lg"><CodeMirrorEditor value={draft.description} onChange={description => setDraft(previous => ({ ...previous, description }))} placeholder={t('projects.descriptionPlaceholder')} taskTitle={project.name} /></div></div></>}
            {error && <p className="project-error" role="alert">{error}</p>}
            <div className="project-modal-actions"><button type="button" className="project-button" onClick={onClose}>{t('common.cancel')}</button><button className="project-button project-button-primary" type="submit">{t(project ? 'common.save' : 'projects.create')}</button></div>
        </form>
    </ProjectDialog>;
}

export function GoalEditor({ projectId, goals, goal, kind, parentId, onClose }: { projectId: string; goals: ProjectGoal[]; goal?: ProjectGoal; kind: ProjectGoal['kind']; parentId?: string; onClose: () => void }) {
    const { t } = useTranslation();
    const { saveGoal } = useProjectGoals();
    const [draft, setDraft] = useState({ title: goal?.title ?? '', criteria: goal?.criteria ?? '', kind: goal?.kind ?? kind, parentId: goal?.parentId ?? parentId ?? '', status: goal?.status ?? 'planned', targetDate: dateInput(goal?.targetDate) });
    const [error, setError] = useState('');
    const hasChildren = goals.some(item => item.parentId === goal?.id);
    function submit(event: FormEvent) {
        event.preventDefault();
        if (!draft.title.trim() || !draft.criteria.trim()) return;
        const now = Date.now();
        try {
            saveGoal({ id: goal?.id ?? `goal-${crypto.randomUUID()}`, projectId, title: draft.title.trim(), criteria: draft.criteria.trim(), kind: draft.kind, parentId: draft.kind === 'short' ? draft.parentId || null : null, status: draft.status, targetDate: dateValue(draft.targetDate), order: goal?.order ?? now, createdAt: goal?.createdAt ?? now, updatedAt: now });
            onClose();
        } catch { setError(t('projects.saveError')); }
    }
    return <ProjectDialog title={t(goal ? 'projects.editGoal' : 'projects.newGoal')} description={t('projects.goalHint')} onClose={onClose}>
        <form onSubmit={submit}>
            <label className="project-field">{t('projects.goalTitle')}<input required autoFocus className="project-input" maxLength={180} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
            <div className="project-form-row"><label className="project-field">{t('projects.horizon')}<select className="project-input" disabled={hasChildren} value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value as ProjectGoal['kind'] })}><option value="long">{t('projects.longGoals')}</option><option value="short">{t('projects.shortGoals')}</option></select></label>
                <label className="project-field">{t('projects.goalStatus')}<select className="project-input" value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as ProjectGoal['status'] })}>{(['planned','active','achieved'] as const).map(status => <option key={status} value={status}>{t(`projects.goalStatuses.${status}`)}</option>)}</select></label></div>
            {draft.kind === 'short' && <label className="project-field">{t('projects.parentGoal')}<select className="project-input" value={draft.parentId} onChange={event => setDraft({ ...draft, parentId: event.target.value })}><option value="">{t('projects.noParent')}</option>{goals.filter(item => item.kind === 'long' && item.id !== goal?.id).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
            <label className="project-field">{t('projects.criteria')}<textarea required className="project-input" rows={3} value={draft.criteria} placeholder={t('projects.criteriaPlaceholder')} onChange={event => setDraft({ ...draft, criteria: event.target.value })} /></label>
            <label className="project-field">{t('projects.targetDate')}<input type="date" className="project-input" value={draft.targetDate} onChange={event => setDraft({ ...draft, targetDate: event.target.value })} /></label>
            {error && <p role="alert" className="project-error">{error}</p>}
            <div className="project-modal-actions"><button type="button" className="project-button" onClick={onClose}>{t('common.cancel')}</button><button type="submit" className="project-button project-button-primary">{t('common.save')}</button></div>
        </form>
    </ProjectDialog>;
}

export function LinkGoalTasks({ goal, tasks, goals, onClose }: { goal: ProjectGoal; tasks: Task[]; goals: ProjectGoal[]; onClose: () => void }) {
    const { t } = useTranslation();
    const { updateTask } = useTaskOperations();
    const [selected, setSelected] = useState(new Set(tasks.filter(task => task.goalId === goal.id).map(task => task.id)));
    const [query, setQuery] = useState('');
    const [error, setError] = useState('');
    function save() {
        try {
            for (const task of tasks) {
                if (selected.has(task.id) && task.goalId !== goal.id) updateTask(task.id, { goalId: goal.id });
                else if (!selected.has(task.id) && task.goalId === goal.id) updateTask(task.id, { goalId: null });
            }
            onClose();
        } catch { setError(t('projects.saveError')); }
    }
    return <ProjectDialog title={t('projects.linkTasks')} description={t('projects.linkHint', { goal: goal.title })} onClose={onClose}>
        <label className="project-field">{t('projects.findTask')}<input className="project-input" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className="max-h-80 overflow-auto">{tasks.filter(task => task.title.toLowerCase().includes(query.toLowerCase())).map(task => <label key={task.id} className="project-task-row">
            <input type="checkbox" checked={selected.has(task.id)} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(task.id); else next.delete(task.id); return next; })} />
            <span><span className={task.completed ? 'line-through opacity-60' : ''}>{task.title || t('common.untitledTask')}</span>{task.goalId && task.goalId !== goal.id && <span className="project-note block">{t('projects.currentGoal')}: {goals.find(item => item.id === task.goalId)?.title}</span>}</span>
        </label>)}{tasks.length === 0 && <p className="project-empty">{t('projects.noTasksToLink')}</p>}</div>
        {error && <p role="alert" className="project-error">{error}</p>}
        <div className="project-modal-actions"><button className="project-button" onClick={onClose}>{t('common.cancel')}</button><button className="project-button project-button-primary" onClick={save}>{t('common.save')}</button></div>
    </ProjectDialog>;
}
