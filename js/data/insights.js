// Binds the pure adaptive engine to the local store. UI code imports from here.
import { all, meta } from './store.js';
import { analyzeData, suggestTimeFrom, tinyFromGoals as tiny, isCheckinTime as isCI, mvdPicks, RULES } from '../core/engine.js';

export { mvdPicks, RULES };
export const liveData = () => ({ tasks: all('tasks'), checkins: all('checkins'), thoughts: all('thoughts'), goals: all('goals') });
export const analyze = (now = new Date()) => analyzeData(liveData(), now);
export const suggestTime = (title, a = analyze()) => suggestTimeFrom(title, all('tasks'), a);
export const tinyFromGoals = () => tiny(all('goals'));
export const isCheckinTime = (now = new Date()) => isCI(now, meta('profile'));
