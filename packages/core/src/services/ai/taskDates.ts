import { format } from 'date-fns';
import { safeParseDate } from '../../utils/dateUtils';
import type { AiTaskAnalysis } from './types';

export const getTaskDateContext = (now = new Date()) => ({
    currentDate: format(now, 'yyyy-MM-dd'),
    currentDateTime: format(now, "yyyy-MM-dd'T'HH:mm:ssxxx"),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
});

export const resolveAiTaskDates = (
    analysis: Pick<AiTaskAnalysis, 'startDate' | 'dueDate' | 'durationMinutes'>,
    fallbackDueDate: Date | null = null,
) => {
    // Preserve explicit times and offsets; date-only values mean local midnight.
    const startDate = safeParseDate(analysis.startDate)?.getTime() ?? null;
    const parsedDueDate = safeParseDate(analysis.dueDate)?.getTime() ?? null;
    const hasStartTime = typeof analysis.startDate === 'string' && /T\d{2}:\d{2}/.test(analysis.startDate);
    const hasEndTime = typeof analysis.dueDate === 'string' && /T\d{2}:\d{2}/.test(analysis.dueDate);
    const duration = analysis.durationMinutes;
    const durationEnd = startDate !== null && hasStartTime
        && typeof duration === 'number' && Number.isFinite(duration) && duration > 0
        ? safeParseDate(startDate + duration * 60_000)?.getTime() ?? null
        : null;

    // An explicit, valid end time wins. Otherwise derive it from the stated
    // duration before considering a date-only response or the user's default.
    const hasValidEndTime = hasEndTime && parsedDueDate !== null
        && (startDate === null || parsedDueDate > startDate);
    return {
        startDate,
        dueDate: (hasValidEndTime ? parsedDueDate : durationEnd)
            ?? parsedDueDate
            ?? safeParseDate(fallbackDueDate)?.getTime()
            ?? null,
    };
};
