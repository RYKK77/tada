import { useEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { aiSettingsAtom, isSettingsOpenAtom, settingsSelectedTabAtom, selectedTaskIdAtom } from '@/store/jotai';
import { useListOperations } from '@/hooks/useListOperations';
import { useTaskOperations } from '@/hooks/useTaskOperations';
import { useProjectGoals } from '@/hooks/useProjectGoals';
import { isAIConfigValid, streamChatCompletionForEditor } from '@/services/aiService';
import { parseProjectDrafts, projectAIContext, projectAssistantPrompt, projectWeek, weeklyFocusTasks, type ProjectAssistantMode, type ProjectDraft } from '@/services/projectPlanning';
import { dateInput } from '@/services/projects';
import { ProjectDialog } from './ProjectDialogs';
import type { List, ProjectGoal, ProjectReview, Task } from '@/types';

function PlanningEditor({ project, tasks, mode, review, now, onClose }: { project: List; tasks: Task[]; mode: 'focus' | 'risks' | 'review'; review?: ProjectReview; now: number; onClose: () => void }) {
    const { t } = useTranslation();
    const { updateList } = useListOperations();
    const [selected, setSelected] = useState(new Set(weeklyFocusTasks(project, tasks, new Date(now)).map(task => task.id)));
    const [content, setContent] = useState(mode === 'risks' ? project.risks ?? '' : review?.content ?? '');
    const [error, setError] = useState('');
    function save() {
        try {
            if (mode === 'focus') updateList(project.id, { weeklyFocus: { weekOf: projectWeek(new Date(now)).weekOf, taskIds: [...selected].filter(id => tasks.some(task => task.id === id)) } });
            else if (mode === 'risks') updateList(project.id, { risks: content.trim() });
            else {
                if (!content.trim()) return;
                const timestamp = Date.now();
                const entry: ProjectReview = { id: review?.id ?? crypto.randomUUID(), content: content.trim(), createdAt: review?.createdAt ?? timestamp, updatedAt: timestamp, source: review?.source ?? 'manual' };
                updateList(project.id, { reviews: review ? (project.reviews ?? []).map(item => item.id === review.id ? entry : item) : [entry, ...(project.reviews ?? [])] });
            }
            onClose();
        } catch { setError(t('projects.saveError')); }
    }
    return <ProjectDialog title={t(`projects.planning.${mode}`)} description={t(`projects.planning.${mode}Hint`)} onClose={onClose}>
        {mode === 'focus' ? <div className="max-h-80 overflow-auto">{tasks.filter(task => !task.completed || selected.has(task.id)).map(task => <label key={task.id} className="project-task-row"><input type="checkbox" checked={selected.has(task.id)} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(task.id); else next.delete(task.id); return next; })} /><span className="break-words min-w-0">{task.title}</span></label>)}{tasks.every(task => task.completed) && selected.size === 0 && <p className="project-empty">{t('projects.noTasksToLink')}</p>}</div> : <label className="project-field">{t(`projects.planning.${mode}`)}<textarea autoFocus className="project-input" rows={10} value={content} onChange={event => setContent(event.target.value)} /></label>}
        {error && <p role="alert" className="project-error">{error}</p>}
        <div className="project-modal-actions"><button className="project-button" onClick={onClose}>{t('common.cancel')}</button><button className="project-button project-button-primary" disabled={mode === 'review' && !content.trim()} onClick={save}>{t('common.save')}</button></div>
    </ProjectDialog>;
}

function AssistantDialog({ project, goals, tasks, now, onClose }: { project: List; goals: ProjectGoal[]; tasks: Task[]; now: number; onClose: () => void }) {
    const { t, i18n } = useTranslation();
    const settings = useAtomValue(aiSettingsAtom);
    const openSettings = useSetAtom(isSettingsOpenAtom);
    const selectSettings = useSetAtom(settingsSelectedTabAtom);
    const { saveGoal } = useProjectGoals();
    const { createTask } = useTaskOperations();
    const { updateList } = useListOperations();
    const [mode, setMode] = useState<ProjectAssistantMode>('goals');
    const [targetGoal, setTargetGoal] = useState('');
    const [drafts, setDrafts] = useState<(ProjectDraft & { key: string; selected: boolean })[]>([]);
    const [report, setReport] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const controller = useRef<AbortController | null>(null);
    useEffect(() => () => controller.current?.abort(), []);
    const configured = settings && isAIConfigValid(settings);
    async function generate() {
        if (!settings || !configured || busy) return;
        const request = new AbortController(); controller.current = request;
        setBusy(true); setError(''); setDrafts([]); setReport(null);
        try {
            const context = { ...projectAIContext(project, goals, tasks, new Date(now)), selectedGoal: mode === 'tasks' ? goals.find(goal => goal.id === targetGoal)?.title ?? null : null };
            const stream = await streamChatCompletionForEditor(settings, projectAssistantPrompt(mode, i18n.language), JSON.stringify(context), request.signal);
            const reader = stream.getReader(); let text = '';
            try {
                while (true) { const chunk = await reader.read(); if (chunk.done) break; text += chunk.value; if (text.length > 50_000) { setError(t('projects.planning.aiError')); request.abort(); return; } }
            } finally { reader.releaseLock(); }
            if (request.signal.aborted) return;
            if (mode === 'report') { if (!text.trim()) throw new Error('emptyReport'); setReport(text.trim()); }
            else setDrafts(parseProjectDrafts(text, mode, goals).map(draft => ({ ...draft, key: crypto.randomUUID(), selected: true })));
        } catch {
            if (!request.signal.aborted) setError(t('projects.planning.aiError'));
        } finally { if (controller.current === request) { controller.current = null; setBusy(false); } }
    }
    function adopt() {
        try {
            const timestamp = Date.now();
            if (mode === 'report') {
                updateList(project.id, { reviews: [{ id: crypto.randomUUID(), content: report?.trim() ?? '', source: 'ai', createdAt: timestamp, updatedAt: timestamp }, ...(project.reviews ?? [])] });
            } else {
                const selected = drafts.filter(draft => draft.selected);
                if (selected.some(draft => !draft.title.trim() || (mode === 'goals' && !draft.criteria.trim()))) { setError(t('projects.planning.incompleteDraft')); return; }
                for (const [index, draft] of selected.entries()) {
                    if (mode === 'goals') saveGoal({ id: `goal-${draft.key}`, projectId: project.id, title: draft.title.trim(), criteria: draft.criteria.trim(), kind: draft.kind, parentId: draft.kind === 'short' && goals.some(goal => goal.id === draft.parentId && goal.kind === 'long') ? draft.parentId : null, status: 'planned', targetDate: null, order: timestamp + index, createdAt: timestamp, updatedAt: timestamp });
                    else createTask({ title: draft.title.trim(), listId: project.id, listName: project.name, goalId: goals.some(goal => goal.id === targetGoal) ? targetGoal : null, content: '', completed: false, completedAt: null, completePercentage: null, dueDate: null, priority: null, order: timestamp + index, subtasks: [] });
                    // Remove adopted rows immediately so a retry cannot duplicate a partial save.
                    setDrafts(previous => previous.filter(item => item.key !== draft.key));
                }
            }
            onClose();
        } catch { setError(t('projects.saveError')); }
    }
    return <ProjectDialog title={t('projects.planning.assistant')} description={t('projects.planning.aiHint')} onClose={onClose}>
        {!configured ? <><p className="project-note">{t('projects.planning.configureHint')}</p><div className="project-modal-actions"><button className="project-button" onClick={onClose}>{t('common.cancel')}</button><button className="project-button project-button-primary" onClick={() => { selectSettings('ai'); openSettings(true); onClose(); }}>{t('projects.planning.configure')}</button></div></> : <>
            <label className="project-field">{t('projects.planning.helpWith')}<select className="project-input" value={mode} disabled={busy} onChange={event => { setMode(event.target.value as ProjectAssistantMode); setDrafts([]); setReport(null); setError(''); }}>{(['goals','tasks','report'] as const).map(value => <option key={value} value={value}>{t(`projects.planning.aiModes.${value}`)}</option>)}</select></label>
            {mode === 'tasks' && <label className="project-field">{t('projects.filterGoal')}<select className="project-input" value={targetGoal} disabled={busy || drafts.length > 0} onChange={event => setTargetGoal(event.target.value)}><option value="">{t('projects.unlinked')}</option>{goals.filter(goal => goal.status !== 'achieved').map(goal => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label>}
            <button className="project-button" disabled={busy} onClick={generate}>{t(busy ? 'projects.planning.generating' : 'projects.planning.generate')}</button>
            {busy && <p role="status" className="project-note mt-3">{t('projects.planning.generatingHint')}</p>}
            {drafts.map((draft, index) => <div className="project-goal mt-4" key={draft.key}><label className="project-field"><span className="flex items-center gap-2"><input type="checkbox" checked={draft.selected} onChange={event => setDrafts(previous => previous.map(item => item.key === draft.key ? { ...item, selected: event.target.checked } : item))} />{t('projects.planning.draft', { index: index + 1 })}</span><input aria-label={t('projects.planning.draftTitle', { index: index + 1 })} className="project-input" maxLength={180} value={draft.title} onChange={event => setDrafts(previous => previous.map(item => item.key === draft.key ? { ...item, title: event.target.value } : item))} /></label>{mode === 'goals' && <><span className="project-badge mb-3">{t(draft.kind === 'long' ? 'projects.longGoals' : 'projects.shortGoals')}</span>{draft.parentId && <p className="project-note mb-3">{t('projects.parentGoal')}: {goals.find(goal => goal.id === draft.parentId)?.title}</p>}<label className="project-field">{t('projects.criteria')}<textarea className="project-input" value={draft.criteria} rows={3} onChange={event => setDrafts(previous => previous.map(item => item.key === draft.key ? { ...item, criteria: event.target.value } : item))} /></label></>}</div>)}
            {report !== null && <label className="project-field mt-4">{t('projects.planning.reportDraft')}<textarea className="project-input" rows={14} value={report} onChange={event => setReport(event.target.value)} /></label>}
            {error && <p role="alert" className="project-error">{error}</p>}
            <div className="project-modal-actions"><button className="project-button" onClick={onClose}>{t('common.cancel')}</button><button className="project-button project-button-primary" disabled={busy || (mode === 'report' ? !report?.trim() : !drafts.some(draft => draft.selected))} onClick={adopt}>{t(mode === 'report' ? 'projects.planning.saveReview' : 'projects.planning.adopt')}</button></div>
        </>}
    </ProjectDialog>;
}

export default function ProjectPlanning({ project, goals, tasks, now, readOnly }: { project: List; goals: ProjectGoal[]; tasks: Task[]; now: number; readOnly: boolean }) {
    const { t } = useTranslation();
    const selectTask = useSetAtom(selectedTaskIdAtom);
    const { updateList } = useListOperations();
    const [editor, setEditor] = useState<{ mode: 'focus' | 'risks' | 'review'; review?: ProjectReview } | null>(null);
    const [assistant, setAssistant] = useState(false);
    const [deleting, setDeleting] = useState<ProjectReview | null>(null);
    const [error, setError] = useState('');
    const focus = weeklyFocusTasks(project, tasks, new Date(now));
    return <>
        <div className="project-grid"><section className="project-panel project-section"><div className="project-section-title"><h2>{t('projects.planning.focus')}</h2>{!readOnly && <button className="project-button" onClick={() => setEditor({ mode: 'focus' })}>{t('projects.planning.choose')}</button>}</div><p className="project-note mb-3">{t('projects.planning.weekOf', { date: projectWeek(new Date(now)).weekOf })}</p>{focus.map(task => <div className="project-task-row" key={task.id}><span className="project-badge">{t(task.completed ? 'projects.planning.done' : 'projects.planning.open')}</span><button className={`project-task-title ${task.completed ? 'line-through opacity-60' : ''}`} onClick={() => selectTask(task.id)}>{task.title}</button></div>)}{!focus.length && <p className="project-empty">{t('projects.planning.noFocus')}</p>}</section>
        <section className="project-panel project-section"><div className="project-section-title"><h2>{t('projects.planning.risks')}</h2>{!readOnly && <button className="project-button" onClick={() => setEditor({ mode: 'risks' })}>{t('common.edit')}</button>}</div>{project.risks ? <p className="text-sm whitespace-pre-wrap break-words">{project.risks}</p> : <p className="project-empty">{t('projects.planning.noRisks')}</p>}</section></div>
        <section className="project-panel project-section"><div className="project-section-title"><h2>{t('projects.planning.reviews')}</h2>{!readOnly && <div className="project-toolbar"><button className="project-button" onClick={() => setEditor({ mode: 'review' })}>{t('projects.planning.addReview')}</button><button className="project-button" onClick={() => setAssistant(true)}>{t('projects.planning.assistant')}</button></div>}</div>{(project.reviews ?? []).length === 0 && <p className="project-empty">{t('projects.planning.noReviews')}</p>}{[...(project.reviews ?? [])].sort((a,b) => b.createdAt - a.createdAt).map(review => <details className="project-goal" key={review.id}><summary className="project-note cursor-pointer">{dateInput(review.createdAt)} · {review.content.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80)}{review.source === 'ai' ? ` · ${t('projects.planning.aiAssisted')}` : ''}</summary><div className="project-description"><ReactMarkdown remarkPlugins={[remarkGfm]}>{review.content}</ReactMarkdown></div>{!readOnly && <div className="project-toolbar mt-3"><button className="project-button" onClick={() => setEditor({ mode: 'review', review })}>{t('common.edit')}</button><button className="project-button" onClick={() => setDeleting(review)}>{t('common.delete')}</button></div>}</details>)}</section>
        {editor && <PlanningEditor project={project} tasks={tasks} now={now} {...editor} onClose={() => setEditor(null)} />}
        {assistant && <AssistantDialog project={project} goals={goals} tasks={tasks} now={now} onClose={() => setAssistant(false)} />}
        {deleting && <ProjectDialog title={t('projects.planning.deleteReview')} description={t('projects.planning.deleteReviewHint')} onClose={() => { setDeleting(null); setError(''); }}>{error && <p className="project-error" role="alert">{error}</p>}<div className="project-modal-actions"><button className="project-button" onClick={() => setDeleting(null)}>{t('common.cancel')}</button><button className="project-button" onClick={() => { try { updateList(project.id, { reviews: (project.reviews ?? []).filter(review => review.id !== deleting.id) }); setDeleting(null); setError(''); } catch { setError(t('projects.saveError')); } }}>{t('common.delete')}</button></div></ProjectDialog>}
    </>;
}
