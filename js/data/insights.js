// Binds the pure adaptive engine to the local store. UI code imports from here.
import { all } from './store.js';
import { analyzeData, suggestTimeFrom, tinyFromGoals as tiny, mvdPicks, RULES } from '../core/engine.js';

export { mvdPicks, RULES };
export const liveData = () => ({ tasks: all('tasks'), checkins: all('checkins'), thoughts: all('thoughts'), goals: all('goals') });
export const analyze = (now = new Date()) => analyzeData(liveData(), now);
export const suggestTime = (title, a = analyze()) => suggestTimeFrom(title, all('tasks'), a);
export const tinyFromGoals = () => tiny(all('goals'));
