import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, Archive, Flag, FolderOpen, Plus, Target } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { userListsAtom, tasksAtom, selectedTaskIdAtom } from '@/store/jotai';
import { projectGoalsAtom, projectNowAtom } from '@/store/projects';
import { useListOperations } from '@/hooks/useListOperations';
import { useProjectGoals } from '@/hooks/useProjectGoals';
import { useTaskOperations } from '@/hooks/useTaskOperations';
import { goalTasks, urgentTasks, urgencyReasons, dateInput } from '@/services/projects';
import { ProjectDialog, ProjectEditor, GoalEditor, LinkGoalTasks } from '@/components/features/projects/ProjectDialogs';
import ProjectPlanning from '@/components/features/projects/ProjectPlanning';
import TaskList from '@/components/features/tasks/TaskList';
import TaskDetail from '@/components/features/tasks/TaskDetail';
import TaskDetailPlaceholder from '@/components/features/tasks/TaskDetailPlaceholder';
import useMediaQuery from '@/hooks/useMediaQuery';
import type { List, ProjectGoal, ProjectStatus, Task } from '@/types';
import '@/components/features/projects/projects.css';

type ProjectTab = 'overview' | 'goals' | 'tasks';
const statuses: ProjectStatus[] = ['planned', 'active', 'paused', 'completed'];
function rememberedTab(id: string): ProjectTab {
    try { const tab = localStorage.getItem(`tada-project-tab-${id}`); if (tab === 'tasks' || tab === 'goals') return tab; } catch { /* Preferences are optional. */ }
    return 'overview';
}

export function ProjectsPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const lists = useAtomValue(userListsAtom) ?? [];
    const tasks = useAtomValue(tasksAtom) ?? [];
    const goals = useAtomValue(projectGoalsAtom) ?? [];
    const now = useAtomValue(projectNowAtom);
    const [archived, setArchived] = useState(false);
    const [creating, setCreating] = useState(false);
    const projects = lists.filter(list => list.name !== 'Inbox' && !!list.archivedAt === archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return <div className="project-workspace text-grey-dark dark:text-neutral-100">
        <header className="project-header"><div className="project-heading"><div><h1>{t('projects.myProjects')}</h1><p className="project-subtitle">{t('projects.indexHint')}</p></div><button className="project-button project-button-primary" onClick={() => setCreating(true)}><Plus size={15} />{t('projects.newProject')}</button></div>
            <div className="project-tabs" role="tablist" aria-label={t('projects.projectScope')}><button id="projects-active" aria-controls="projects-grid" role="tab" aria-selected={!archived} onClick={() => setArchived(false)}>{t('projects.currentProjects')}</button><button id="projects-archived" aria-controls="projects-grid" role="tab" aria-selected={archived} onClick={() => setArchived(true)}>{t('projects.archivedProjects')}</button></div>
        </header>
        <div className="project-scroll" id="projects-grid" role="tabpanel" aria-labelledby={archived ? 'projects-archived' : 'projects-active'}><div className="project-wrap">
            {!projects.length && <div className="project-panel"><FolderOpen size={25} className="mb-4 opacity-50" /><p>{t(archived ? 'projects.noArchived' : 'projects.noProjects')}</p>{!archived && <button className="project-button mt-4" onClick={() => setCreating(true)}>{t('projects.newProject')}</button>}</div>}
            <div className="project-list-grid">{projects.map(project => {
                const projectTasks = tasks.filter(task => task.listId === project.id && task.listName !== 'Trash');
                const urgent = urgentTasks(projectTasks, new Date(now));
                const current = goals.filter(goal => goal.projectId === project.id && goal.kind === 'short' && goal.status !== 'achieved').sort((a,b) => Number(b.status === 'active') - Number(a.status === 'active') || a.order - b.order)[0];
                return <Link key={project.id} className="project-panel project-card" to={`/projects/${encodeURIComponent(project.id)}`}><div className="flex items-center justify-between gap-2"><FolderOpen size={20} className="text-primary" /><span className="project-badge">{t(`projects.statuses.${project.status ?? 'active'}`)}</span></div><h2>{project.name}</h2><p className="project-note">{project.summary || t('projects.noSummary')}</p><div className="text-sm"><span className="project-note">{t('projects.currentGoal')}</span><p className="mt-1 break-words">{current?.title || t('projects.noCurrentGoal')}</p></div><div className="project-card-footer">{!archived && urgent.length > 0 && <span className="project-badge project-badge-urgent">{t('projects.urgentCount', { count: urgent.length })}</span>}<span>{t('projects.openTaskCount', { count: projectTasks.filter(task => !task.completed).length })}</span>{project.targetDate && <span>{dateInput(project.targetDate)}</span>}</div></Link>;
            })}</div>
        </div></div>
        {creating && <ProjectEditor onClose={() => setCreating(false)} onCreated={id => navigate(`/projects/${encodeURIComponent(id)}`)} />}
    </div>;
}

function ProjectTaskRow({ task, urgent = false, now, paused = false, readOnly = false }: { task: Task; urgent?: boolean; now: number; paused?: boolean; readOnly?: boolean }) {
    const { t } = useTranslation();
    const [, selectTask] = useAtom(selectedTaskIdAtom);
    const { updateTask } = useTaskOperations();
    return <div className="project-task-row"><input type="checkbox" aria-label={t('projects.completeTask', { title: task.title })} checked={task.completed} disabled={readOnly} onChange={event => updateTask(task.id, { completed: event.target.checked, completePercentage: event.target.checked ? 100 : null })} /><div className="flex-1 min-w-0"><button className={`project-task-title ${task.completed ? 'line-through opacity-50' : ''}`} onClick={() => selectTask(task.id)}>{task.title || t('common.untitledTask')}</button><div className="project-task-meta">{urgent && urgencyReasons(task, new Date(now)).map(reason => <span key={reason} className="project-badge project-badge-urgent">{t(`projects.urgency.${reason}`)}</span>)}{task.priority && <span className="project-badge">P{task.priority}</span>}{task.dueDate && <span className="project-note">{dateInput(task.dueDate)}</span>}{paused && <span className="project-badge">{t('projects.statuses.paused')}</span>}</div></div></div>;
}

function GoalCard({ goal, goals, tasks, now, readOnly, onEdit, onLink, onDelete, onAddChild }: { goal: ProjectGoal; goals: ProjectGoal[]; tasks: Task[]; now: number; readOnly: boolean; onEdit: (goal: ProjectGoal) => void; onLink: (goal: ProjectGoal) => void; onDelete: (goal: ProjectGoal) => void; onAddChild: (id: string) => void }) {
    const { t } = useTranslation();
    const linked = goalTasks(goal, goals, tasks);
    const done = linked.filter(task => task.completed).length;
    return <article className="project-goal"><div className="flex items-start justify-between gap-3"><h3>{goal.title}</h3><span className="project-badge">{t(`projects.goalStatuses.${goal.status}`)}</span></div><p className="project-goal-criteria">{goal.criteria}</p>
        {linked.length > 0 && <div className="project-progress" role="progressbar" aria-label={t('projects.taskProgress')} aria-valuenow={done} aria-valuemin={0} aria-valuemax={linked.length}><span style={{ width: `${100 * done / linked.length}%` }} /></div>}
        <div className="project-goal-footer"><span className="project-note">{t('projects.taskProgressCount', { done, total: linked.length })}{goal.targetDate ? ` · ${dateInput(goal.targetDate)}` : ''}</span><div className="project-toolbar">{!readOnly && <><button className="project-button" onClick={() => onLink(goal)}>{t('projects.linkTasks')}</button><button className="project-button" onClick={() => onEdit(goal)}>{t('common.edit')}</button><button className="project-button" aria-label={t('projects.deleteGoalNamed', { title: goal.title })} onClick={() => onDelete(goal)}>{t('common.delete')}</button></>}</div></div>
        {linked.length > 0 && done === linked.length && goal.status !== 'achieved' && <p className="project-note mt-2">{t('projects.readyForReview')}</p>}
        {linked.length > 0 && <details className="mt-3"><summary className="project-note cursor-pointer">{t('projects.relatedTasks', { count: linked.length })}</summary>{linked.map(task => <ProjectTaskRow key={task.id} task={task} now={now} readOnly={readOnly} />)}</details>}
        {goal.kind === 'long' && !readOnly && <button className="project-button mt-3" onClick={() => onAddChild(goal.id)}><Plus size={13} />{t('projects.addShortGoal')}</button>}
    </article>;
}

function ProjectWorkspace({ project }: { project: List }) {
    const { t } = useTranslation();
    const allTasks = useAtomValue(tasksAtom);
    const allGoals = useAtomValue(projectGoalsAtom);
    const now = useAtomValue(projectNowAtom);
    const [selectedTask, selectTask] = useAtom(selectedTaskIdAtom);
    const { updateList } = useListOperations();
    const { deleteGoal } = useProjectGoals();
    const isWide = useMediaQuery('(min-width: 768px)');
    const [tab, setTab] = useState<ProjectTab>(() => rememberedTab(project.id));
    const [editingProject, setEditingProject] = useState(false);
    const [goalEditor, setGoalEditor] = useState<{ goal?: ProjectGoal; kind: ProjectGoal['kind']; parentId?: string } | null>(null);
    const [linkingGoal, setLinkingGoal] = useState<ProjectGoal | null>(null);
    const [deletingGoal, setDeletingGoal] = useState<ProjectGoal | null>(null);
    const [archivePrompt, setArchivePrompt] = useState(false);
    const [completionPrompt, setCompletionPrompt] = useState(false);
    const [goalFilter, setGoalFilter] = useState('all');
    const [showCompleted, setShowCompleted] = useState(false);
    const [groupByGoal, setGroupByGoal] = useState(false);
    const [error, setError] = useState('');
    const tasks = useMemo(() => (allTasks ?? []).filter(task => task.listId === project.id && task.listName !== 'Trash'), [allTasks, project.id]);
    const goals = useMemo(() => (allGoals ?? []).filter(goal => goal.projectId === project.id).sort((a,b) => a.order - b.order), [allGoals, project.id]);
    const longGoals = goals.filter(goal => goal.kind === 'long');
    const shortGoals = goals.filter(goal => goal.kind === 'short');
    const currentGoals = shortGoals.filter(goal => goal.status !== 'achieved').sort((a,b) => Number(b.status === 'active') - Number(a.status === 'active') || a.order - b.order).slice(0,3);
    const urgent = urgentTasks(tasks, new Date(now));
    const openTasks = tasks.filter(task => !task.completed);
    const archived = !!project.archivedAt;
    const readOnly = archived || project.status === 'completed';
    const filteredGoalIds = goalFilter === 'all' || goalFilter === 'none' ? undefined : [goalFilter, ...goals.filter(goal => goal.parentId === goalFilter).map(goal => goal.id)];
    function changeTab(next: ProjectTab) { setTab(next); selectTask(null); try { localStorage.setItem(`tada-project-tab-${project.id}`, next); } catch { /* Optional preference. */ } }
    function changeStatus(status: ProjectStatus) {
        if (status === 'completed' && openTasks.length) { setCompletionPrompt(true); return; }
        try { updateList(project.id, { status }); setError(''); } catch { setError(t('projects.saveError')); }
    }
    function toggleArchive() { try { updateList(project.id, { archivedAt: archived ? null : Date.now() }); setArchivePrompt(false); selectTask(null); } catch { setError(t('projects.saveError')); } }
    const goalCard = (goal: ProjectGoal) => <GoalCard key={goal.id} goal={goal} goals={goals} tasks={tasks} now={now} readOnly={readOnly} onEdit={item => setGoalEditor({ goal: item, kind: item.kind })} onLink={setLinkingGoal} onDelete={setDeletingGoal} onAddChild={parentId => setGoalEditor({ kind: 'short', parentId })} />;
    return <div className="project-workspace text-grey-dark dark:text-neutral-100">
        <header className="project-header"><Link to="/projects" className="project-eyebrow inline-flex items-center gap-1"><ArrowLeft size={13} />{t('projects.myProjects')}</Link><div className="project-heading"><div className="min-w-0"><h1>{project.name}</h1><p className="project-subtitle">{project.summary || t('projects.noSummary')}</p><div className="project-toolbar mt-3">{archived && <span className="project-badge"><Archive size={12} />{t('projects.archived')}</span>}{project.targetDate && <span className="project-note">{t('projects.targetDate')}: {dateInput(project.targetDate)}</span>}</div></div><div className="project-toolbar"><select aria-label={t('projects.projectStatus')} className="project-input !w-auto !text-xs" value={project.status ?? 'active'} disabled={archived} onChange={event => changeStatus(event.target.value as ProjectStatus)}>{statuses.map(status => <option key={status} value={status}>{t(`projects.statuses.${status}`)}</option>)}</select>{!archived && <button className="project-button" onClick={() => setEditingProject(true)}>{t('projects.editProject')}</button>}<button className="project-button" onClick={() => archived ? toggleArchive() : setArchivePrompt(true)}>{t(archived ? 'projects.restore' : 'projects.archive')}</button></div></div>
            <div className="project-tabs" role="tablist" aria-label={t('projects.projectViews')}>{(['overview','goals','tasks'] as const).map(item => <button key={item} id={`project-tab-${item}`} role="tab" aria-controls="project-content" aria-selected={tab === item} onClick={() => changeTab(item)}>{t(`projects.tabs.${item}`)}</button>)}</div>
        </header>
        {error && <p role="alert" className="project-error mx-6">{error}</p>}
        <div id="project-content" role="tabpanel" aria-labelledby={`project-tab-${tab}`} className="flex flex-col flex-1 min-h-0">
        {tab === 'tasks' ? <><div className="project-task-filters"><label className="flex items-center gap-2">{t('projects.filterGoal')}<select className="project-input" value={goalFilter} onChange={event => setGoalFilter(event.target.value)}><option value="all">{t('projects.allGoals')}</option><option value="none">{t('projects.unlinked')}</option>{goals.map(goal => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label><label className="flex items-center gap-2"><input type="checkbox" checked={showCompleted} onChange={event => setShowCompleted(event.target.checked)} />{t('projects.showCompleted')}</label><label className="flex items-center gap-2"><input type="checkbox" checked={groupByGoal} onChange={event => setGroupByGoal(event.target.checked)} />{t('projects.groupByGoal')}</label>{readOnly && <span className="project-note">{t(archived ? 'projects.restoreToEdit' : 'projects.reopenToEdit')}</span>}</div><div className="project-task-layout"><div className="project-task-list"><TaskList title={project.name} projectId={project.id} goalIds={filteredGoalIds} unlinkedOnly={goalFilter === 'none'} includeCompleted={showCompleted} groupByGoal={groupByGoal} readOnly={readOnly} /></div><div className="project-task-detail">{selectedTask ? <TaskDetail key={selectedTask} /> : <TaskDetailPlaceholder />}</div></div></> : <div className="project-scroll"><div className="project-wrap">
            {tab === 'overview' ? <><div className="project-grid"><section className="project-panel project-section"><div className="project-section-title"><h2 className="flex items-center gap-2"><Flag size={16} className="text-primary" />{t('projects.urgent')}</h2><span className="project-note">{urgent.length}</span></div><p className="project-note mb-3">{t('projects.urgentHint')}</p>{urgent.length ? urgent.slice(0,6).map(task => <ProjectTaskRow key={task.id} task={task} urgent now={now} paused={project.status === 'paused'} readOnly={readOnly} />) : <p className="project-empty">{t('projects.noUrgent')}</p>}{urgent.length > 6 && <details><summary className="project-note cursor-pointer">{t('projects.moreUrgent', { count: urgent.length - 6 })}</summary>{urgent.slice(6).map(task => <ProjectTaskRow key={task.id} task={task} urgent now={now} readOnly={readOnly} />)}</details>}<button className="project-button mt-3" onClick={() => changeTab('tasks')}>{t('projects.viewTasks')}</button></section><section className="project-panel project-section"><div className="project-section-title"><h2 className="flex items-center gap-2"><Target size={16} className="text-primary" />{t('projects.currentGoals')}</h2>{!readOnly && <button className="project-button" onClick={() => setGoalEditor({ kind: 'short' })}><Plus size={13} />{t('projects.add')}</button>}</div>{currentGoals.length ? currentGoals.map(goalCard) : <p className="project-empty">{t('projects.noCurrentGoal')}</p>}{shortGoals.length > currentGoals.length && <button className="project-button mt-3" onClick={() => changeTab('goals')}>{t('projects.viewGoals')}</button>}</section></div>
                <ProjectPlanning project={project} goals={goals} tasks={tasks} now={now} readOnly={readOnly} />
                <section className="project-panel project-section"><div className="project-section-title"><h2>{t('projects.longGoals')}</h2>{!readOnly && <button className="project-button" onClick={() => setGoalEditor({ kind: 'long' })}><Plus size={13} />{t('projects.addLongGoal')}</button>}</div>{longGoals.length ? longGoals.map(goalCard) : <p className="project-empty">{t('projects.noLongGoals')}</p>}</section>
                <section className="project-panel project-section"><div className="project-section-title"><h2>{t('projects.description')}</h2>{!archived && <button className="project-button" onClick={() => setEditingProject(true)}>{t('common.edit')}</button>}</div>{project.description ? <div className="project-description"><ReactMarkdown remarkPlugins={[remarkGfm]}>{project.description}</ReactMarkdown></div> : <p className="project-empty">{t('projects.descriptionPlaceholder')}</p>}</section></> : <><div className="project-section-title"><div><h2>{t('projects.goalMap')}</h2><p className="project-note mt-2">{t('projects.goalHint')}</p></div>{!readOnly && <div className="project-toolbar"><button className="project-button" onClick={() => setGoalEditor({ kind: 'long' })}>{t('projects.addLongGoal')}</button><button className="project-button project-button-primary" onClick={() => setGoalEditor({ kind: 'short' })}>{t('projects.addShortGoal')}</button></div>}</div>{longGoals.map(goal => <section className="project-panel project-section" key={goal.id}>{goalCard(goal)}{shortGoals.filter(child => child.parentId === goal.id).length > 0 && <div className="project-goal-children">{shortGoals.filter(child => child.parentId === goal.id).map(goalCard)}</div>}</section>)}{shortGoals.some(goal => !goal.parentId) && <section className="project-panel project-section"><div className="project-section-title"><h2>{t('projects.independentShortGoals')}</h2></div>{shortGoals.filter(goal => !goal.parentId).map(goalCard)}</section>}{goals.length === 0 && <p className="project-empty">{t('projects.noGoals')}</p>}</>}
        </div></div>}
        </div>
        {selectedTask && (tab !== 'tasks' || !isWide) && <Dialog.Root open onOpenChange={open => { if (!open) selectTask(null); }}><Dialog.Portal><Dialog.Overlay className="project-modal-overlay" /><Dialog.Content className="project-drawer" aria-describedby={undefined}><Dialog.Title className="sr-only">{t('projects.taskDetails')}</Dialog.Title><TaskDetail key={selectedTask} /></Dialog.Content></Dialog.Portal></Dialog.Root>}
        {editingProject && <ProjectEditor project={project} onClose={() => setEditingProject(false)} />}
        {goalEditor && <GoalEditor projectId={project.id} goals={goals} {...goalEditor} onClose={() => setGoalEditor(null)} />}
        {linkingGoal && <LinkGoalTasks goal={linkingGoal} goals={goals} tasks={tasks} onClose={() => setLinkingGoal(null)} />}
        {deletingGoal && <ProjectDialog title={t('projects.deleteGoal')} description={t('projects.deleteGoalHint')} onClose={() => setDeletingGoal(null)}><p>{deletingGoal.title}</p><div className="project-modal-actions"><button className="project-button" onClick={() => setDeletingGoal(null)}>{t('common.cancel')}</button><button className="project-button" onClick={() => { deleteGoal(deletingGoal.id); if (goalFilter === deletingGoal.id) setGoalFilter('all'); setDeletingGoal(null); }}>{t('common.delete')}</button></div></ProjectDialog>}
        {archivePrompt && <ProjectDialog title={t('projects.archive')} description={t('projects.archiveHint', { count: openTasks.length })} onClose={() => setArchivePrompt(false)}><div className="project-modal-actions"><button className="project-button" onClick={() => setArchivePrompt(false)}>{t('common.cancel')}</button><button className="project-button project-button-primary" onClick={toggleArchive}>{t('projects.archive')}</button></div></ProjectDialog>}
        {completionPrompt && <ProjectDialog title={t('projects.unfinishedTitle')} description={t('projects.unfinishedHint', { count: openTasks.length })} onClose={() => setCompletionPrompt(false)}><ul className="max-h-60 overflow-auto space-y-3 text-sm">{openTasks.map(task => <li key={task.id}>{task.title || t('common.untitledTask')}</li>)}</ul><div className="project-modal-actions"><button className="project-button" onClick={() => setCompletionPrompt(false)}>{t('common.cancel')}</button><button className="project-button project-button-primary" onClick={() => { setCompletionPrompt(false); setGoalFilter('all'); changeTab('tasks'); }}>{t('projects.handleTasks')}</button></div></ProjectDialog>}
    </div>;
}

export default function ProjectPage() {
    const { projectId } = useParams();
    const lists = useAtomValue(userListsAtom);
    const { t } = useTranslation();
    if (!lists) return null;
    const project = lists.find(list => list.id === projectId && list.name !== 'Inbox');
    if (!project) return <div className="p-8"><p>{t('projects.notFound')}</p><Link to="/projects" className="project-button mt-4">{t('projects.myProjects')}</Link></div>;
    return <ProjectWorkspace key={project.id} project={project} />;
}
