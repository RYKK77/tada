import { atom } from 'jotai';
import { RESET } from 'jotai/utils';
import type { ProjectGoal } from '@/types';
import type { LocalDataAtom } from './types';
import storageManager from '@/services/storageManager';

const baseGoalsAtom = atom<ProjectGoal[]>([]);
export const projectGoalsAtom: LocalDataAtom<ProjectGoal[]> = atom(
    get => get(baseGoalsAtom),
    (get, set, update) => {
        if (update === RESET) { set(baseGoalsAtom, [...storageManager.get().fetchGoals()]); return; }
        set(baseGoalsAtom, typeof update === 'function' ? update(get(baseGoalsAtom)) : update);
    }
);
projectGoalsAtom.onMount = set => set(RESET);

export const projectNowAtom = atom(Date.now());
projectNowAtom.onMount = set => {
    const refresh = () => set(Date.now());
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
};
