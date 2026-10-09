import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { RESET } from 'jotai/utils';
import { projectGoalsAtom } from '@/store/projects';
import { tasksAtom } from '@/store/tasks';
import storageManager from '@/services/storageManager';
import type { ProjectGoal } from '@/types';
import { normalizeTaskProject } from '@/services/projects';

export function useProjectGoals() {
    const setGoals = useSetAtom(projectGoalsAtom);
    const setTasks = useSetAtom(tasksAtom);
    const saveGoal = useCallback((goal: ProjectGoal) => {
        const service = storageManager.get();
        const current = service.fetchGoals();
        const next = current.some(item => item.id === goal.id) ? current.map(item => item.id === goal.id ? goal : item) : [...current, goal];
        setGoals([...service.updateGoals(next)]);
    }, [setGoals]);
    const deleteGoal = useCallback((id: string) => {
        const service = storageManager.get();
        const goals = service.updateGoals(service.fetchGoals().filter(goal => goal.id !== id));
        service.updateTasks(service.fetchTasks().map(task => normalizeTaskProject(task, service.fetchLists(), goals)));
        setGoals([...goals]);
        setTasks(RESET);
    }, [setGoals, setTasks]);
    return { saveGoal, deleteGoal };
}
