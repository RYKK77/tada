import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

process.env.TZ = 'Asia/Shanghai';
const require = createRequire(import.meta.url);
const { build } = await import(require.resolve('esbuild', { paths: [require.resolve('vite')] }));
const root = fileURLToPath(new URL('..', import.meta.url));
const idleWrites = [];
globalThis.window = { addEventListener() {}, requestIdleCallback: callback => idleWrites.push(callback) };
globalThis.requestIdleCallback = window.requestIdleCallback;
globalThis.document = { addEventListener() {} };
function memoryStorage() { const items = new Map(); return { getItem: key => items.get(key) ?? null, setItem: (key,value) => items.set(key,String(value)), removeItem: key => items.delete(key) }; }
globalThis.localStorage = memoryStorage();
const migrations = [...readFileSync(`${root}/packages/desktop/src-tauri/src/lib.rs`, 'utf8').matchAll(/sql: r#"([\s\S]*?)"#/g)].map(match => match[1]);
const stubs = {
    '@tada/core/store/jotai': `export const defaultAISettingsForApi=()=>({}); export const defaultAppearanceSettingsForApi=()=>({}); export const defaultPreferencesSettingsForApi=()=>({}); export const defaultProxySettingsForApi=()=>({}); export const getTaskGroupCategory=()=> 'nodate';`,
    '@tauri-apps/plugin-sql': `export default { load: async () => ({ select: async (sql, args=[]) => globalThis.__projectTestDb.prepare(sql).all(...args), execute: async (sql,args=[]) => { const result=globalThis.__projectTestDb.prepare(sql).run(...args); return {rowsAffected:result.changes}; } }) };`,
};
async function loadSource(file) {
    const result = await build({ entryPoints: [`${root}/${file}`], bundle:true, write:false, platform:'node', format:'esm', plugins:[{ name:'storage-test-dependencies', setup(plugin) {
        plugin.onResolve({filter:/^@tada\/core\/store\/jotai$|^@tauri-apps\/plugin-sql$/}, args=>({path:args.path,namespace:'test-stub'}));
        plugin.onLoad({filter:/.*/,namespace:'test-stub'},args=>({contents:stubs[args.path],loader:'js'}));
        plugin.onResolve({filter:/^@tada\/core\/(types|projects)$/},args=>({path:`${root}/packages/core/src/${args.path.endsWith('/types')?'types/index.ts':'services/projects.ts'}`}));
    }}] });
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const domain = await loadSource('packages/core/src/services/projects.ts');
const planning = await loadSource('packages/core/src/services/projectPlanning.ts');
const { LocalStorageService } = await loadSource('packages/web/src/services/localStorageService.ts');
const { SqliteStorageService } = await loadSource('packages/desktop/src/services/sqliteStorageService.ts');
const day = offset => new Date(2026,9,9 + offset).getTime();
const inbox = { id:'inbox',name:'Inbox',order:0 };
const project = { id:'p',name:'Example',order:1 };
const baseTask = { id:'task',title:'Task',listId:'p',listName:'Example',goalId:'goal-short',completed:false,completedAt:null,completePercentage:null,content:'Keep this **body**',order:1,createdAt:1,updatedAt:1,dueDate:null,priority:null,subtasks:[],groupCategory:'nodate' };
const baseGoal = { id:'goal-long',projectId:'p',title:'Outcome',criteria:'Verified result',kind:'long',parentId:null,status:'active',targetDate:day(30),order:1,createdAt:1,updatedAt:1 };
const goals = [baseGoal,{...baseGoal,id:'goal-short',title:'Milestone',kind:'short',parentId:'goal-long',order:2}];
const options = { includeLists:true,includeTasks:true,includeSettings:false,includeSummaries:false,includeEcho:false,replaceAllData:true,conflictResolution:'keep-imported' };

function freshSqlite(legacy = false) {
    globalThis.__projectTestDb = new DatabaseSync(':memory:');
    __projectTestDb.exec('PRAGMA foreign_keys=ON');
    migrations.slice(0,3).forEach(sql => __projectTestDb.exec(sql));
    if (legacy) {
        __projectTestDb.prepare('INSERT INTO lists(id,name,"order") VALUES(?,?,?)').run('p','Example',1);
        __projectTestDb.prepare('INSERT INTO tasks(id,title,list_id,list_name,content,"order",created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('old-task','Legacy task','p','Example','Old body',1,1,1);
    }
    migrations.slice(3).forEach(sql=>__projectTestDb.exec(sql));
}
async function freshAdapter(kind, legacy=false) {
    idleWrites.length=0;
    if (kind==='web') {
        globalThis.localStorage = memoryStorage();
        localStorage.setItem('tada-lists',JSON.stringify([inbox,...(legacy?[project]:[])]));
        if (legacy) localStorage.setItem('tada-tasks',JSON.stringify([{...baseTask,id:'old-task',goalId:undefined,content:'Old body'}]));
        return new LocalStorageService();
    }
    freshSqlite(legacy);
    const service = new SqliteStorageService(); await service.initialize(); await service.preloadData(); return service;
}
async function reload(kind) {
    if (kind==='web') return new LocalStorageService();
    const service = new SqliteStorageService(); await service.initialize(); await service.preloadData(); return service;
}
async function seed(service) {
    service.updateLists([inbox,project]); service.updateGoals(goals);
    service.updateTasks([{...baseTask}]); await service.flush();
}

test('legacy lists gain defaults without changing identity or the Inbox',()=>{
    assert.equal(domain.normalizeProject(project).status,'active');
    assert.equal(domain.normalizeProject(project).id,'p');
    assert.equal(domain.normalizeProject(inbox).status,undefined);
});
test('urgency uses local date boundaries, deduplicates manual flags, and does not confuse importance with urgency',()=>{
    const now = new Date(2026,9,9,15);
    assert.deepEqual(domain.urgencyReasons({...baseTask,dueDate:day(-1),urgent:true},now),['overdue','manual']);
    assert.deepEqual(domain.urgencyReasons({...baseTask,dueDate:day(0)},now),['today']);
    assert.deepEqual(domain.urgencyReasons({...baseTask,dueDate:day(3)+86_399_999},now),['soon']);
    assert.deepEqual(domain.urgencyReasons({...baseTask,dueDate:day(4),priority:1},now),[]);
    assert.deepEqual(domain.urgencyReasons({...baseTask,urgent:true},now),['manual']);
    assert.deepEqual(domain.urgencyReasons({...baseTask,urgent:true,completed:true},now),[]);
    assert.deepEqual(domain.urgencyReasons({...baseTask,urgent:true,listName:'Trash'},now),[]);
    assert.deepEqual(domain.urgencyReasons({...baseTask,dueDate:day(0)},new Date(day(1))),['overdue']);
});
test('urgent task ordering respects reason, priority, and dates without duplicates',()=>{
    const input=[{...baseTask,id:'soon',dueDate:day(2),priority:1},{...baseTask,id:'manual',urgent:true},{...baseTask,id:'today',dueDate:day(0),priority:3},{...baseTask,id:'late',dueDate:day(-1),urgent:true}];
    assert.deepEqual(domain.urgentTasks(input,new Date(day(0))).map(task=>task.id),['late','today','manual','soon']);
});
test('long-term goal counts each parent/child task once and never auto-verifies a goal',()=>{
    const tasks=[{...baseTask,completed:true},{...baseTask,id:'direct',goalId:'goal-long'},{...baseTask,id:'deleted',listName:'Trash'},{...baseTask,id:'wrong',listId:'other'}];
    assert.equal(domain.goalTasks(baseGoal,goals,tasks).length,2); assert.equal(baseGoal.status,'active');
});
test('deleting parents keeps child goals independent; cross-project and cyclic parent links are removed',()=>{
    assert.equal(domain.normalizeGoals(goals.slice(1),[project])[0].parentId,null);
    assert.equal(domain.normalizeGoals([{...goals[1],parentId:'goal-short'}],[project])[0].parentId,null);
    assert.equal(domain.normalizeGoals([{...goals[1],projectId:'missing'}],[project]).length,0);
});
test('moving a task clears its goal and legacy name-only moves resolve an ID',()=>{
    const lists=[inbox,project,{id:'other',name:'Other'}];
    const moved=domain.taskProjectUpdates(baseTask,{listName:'Other'},lists,goals);
    assert.equal(moved.goalId,null); assert.equal(moved.listId,'other');
    assert.equal(domain.normalizeTaskProject({...baseTask,listId:null},lists,goals).listId,'p');
    assert.equal(domain.normalizeTaskProject({...baseTask,listId:null,listName:'Trash'},lists,goals).listId,null);
    assert.equal(domain.taskProjectUpdates({...baseTask,listName:'Trash'},{listName:'Inbox'},lists,goals).listId,'inbox');
});

for (const kind of ['web','sqlite']) {
    test(`${kind}: old lists and task content survive upgrade and reload`,async()=>{
        const service=await freshAdapter(kind,true);
        assert.equal(service.fetchLists().find(list=>list.id==='p').status,'active');
        assert.equal(service.fetchTasks().find(task=>task.id==='old-task').content,'Old body');
        assert.equal(service.fetchGoals().length,0);
        await service.flush();
    });
    test(`${kind}: project, goals, task links, urgent flag, dates and Markdown survive save and reload`,async()=>{
        const service=await freshAdapter(kind); await seed(service);
        service.updateList('p',{summary:'Summary',description:'# Full project overview',status:'paused',targetDate:day(20)});
        service.updateTask('task',{goalId:'goal-short',urgent:true,startDate:day(0),dueDate:day(3)});
        await service.flush();
        const reopened=await reload(kind); const task=reopened.fetchTasks()[0];
        assert.equal(reopened.fetchLists().find(list=>list.id==='p').description,'# Full project overview');
        assert.equal(reopened.fetchGoals().find(goal=>goal.id==='goal-short').parentId,'goal-long');
        assert.equal(task.goalId,'goal-short');assert.equal(task.urgent,true);assert.equal(task.startDate,day(0));assert.equal(task.content,baseTask.content);
    });
    test(`${kind}: completion is guarded; archive/restore preserves open tasks; moves clear goal references`,async()=>{
        const service=await freshAdapter(kind); await seed(service);
        assert.throws(()=>service.updateList('p',{status:'completed'}),/projectHasOpenTasks/);
        service.updateList('p',{archivedAt:123});
        assert.equal(domain.isArchivedTask(service.fetchTasks()[0],service.fetchLists()),true);
        assert.equal(service.fetchTasks()[0].completed,false);
        service.updateList('p',{archivedAt:null});
        assert.equal(domain.isArchivedTask(service.fetchTasks()[0],service.fetchLists()),false);
        const moved=service.updateTask('task',{listName:'Inbox'});assert.equal(moved.listId,'inbox');assert.equal(moved.goalId,null);
        service.updateList('p',{status:'completed'}); await service.flush();
    });
    test(`${kind}: rename does not restore trashed tasks and does not change project identity`,async()=>{
        const service=await freshAdapter(kind); await seed(service);
        service.updateTask('task',{listName:'Trash'});service.updateList('p',{name:'Renamed'});await service.flush();
        const reopened=await reload(kind);assert.equal(reopened.fetchTasks()[0].listName,'Trash');assert.equal(reopened.fetchTasks()[0].listId,'p');
    });
    test(`${kind}: new backups round-trip goals and associations; legacy and task-only backups stay compatible`,async()=>{
        const service=await freshAdapter(kind); await seed(service);service.updateList('p',{description:'Backup me'});service.updateTask('task',{urgent:true});
        const backup=JSON.parse(JSON.stringify(service.exportData()));assert.equal(backup.version,'2.0.0');assert.equal(backup.data.goals.length,2);
        const result=service.importData(backup,options);assert.equal(result.success,true);await service.flush();
        const reopened=await reload(kind);assert.equal(reopened.fetchTasks()[0].goalId,'goal-short');assert.equal(reopened.fetchGoals().length,2);
        const legacy=structuredClone(backup);legacy.version='1.0.0';delete legacy.data.goals;delete legacy.data.tasks[0].goalId;delete legacy.data.lists.find(list=>list.id==='p').status;
        assert.equal(reopened.importData(legacy,options).success,true);await reopened.flush();assert.equal(reopened.fetchGoals().length,0);assert.equal(reopened.fetchTasks()[0].goalId,null);
        assert.equal(reopened.importData(backup,{...options,includeLists:false}).success,true);assert.equal(reopened.fetchTasks()[0].goalId,null);await reopened.flush();
    });
    test(`${kind}: newer metadata and goal conflict resolution use timestamps, even when the name is unchanged`,async()=>{
        const service=await freshAdapter(kind);await seed(service);
        service.updateList('p',{summary:'Local'});const backup=structuredClone(service.exportData());
        backup.data.lists.find(list=>list.id==='p').summary='Imported';backup.data.lists.find(list=>list.id==='p').updatedAt=Date.now()+10000;
        backup.data.goals[0].criteria='New criteria';backup.data.goals[0].updatedAt=20;
        assert.ok(service.analyzeImport(backup,options).some(conflict=>conflict.type==='goal'));
        service.importData(backup,{...options,replaceAllData:false,conflictResolution:'keep-newer'},new Map([['goal-long','keep-local']]));
        assert.equal(service.fetchLists().find(list=>list.id==='p').summary,'Imported');assert.equal(service.fetchGoals()[0].criteria,baseGoal.criteria);await service.flush();
    });
}

test('SQLite: list reorder and task batch edits preserve foreign keys and subtasks',async()=>{
    const service=await freshAdapter('sqlite');await seed(service);
    service.createSubtask('task',{title:'Keep child',order:0,dueDate:null});await service.flush();
    await service.batchUpdateLists([...service.fetchLists()].reverse());await service.batchUpdateTasks([{...service.fetchTasks()[0],urgent:true}]);await service.flush();
    const reopened=await reload('sqlite');assert.equal(reopened.fetchTasks()[0].listId,'p');assert.equal(reopened.fetchTasks()[0].subtasks.length,1);assert.equal(reopened.fetchTasks()[0].goalId,'goal-short');
});

test('backups move between Web and SQLite without losing project metadata or task links',async()=>{
    const web=await freshAdapter('web');await seed(web);web.updateList('p',{description:'Shared project context',archivedAt:55,risks:'Waiting on review',weeklyFocus:{weekOf:'2026-10-05',taskIds:['task']},reviews:[{id:'review',content:'# Lessons',source:'ai',createdAt:1,updatedAt:2}]});
    const webBackup=structuredClone(web.exportData());
    const desktop=await freshAdapter('sqlite');assert.equal(desktop.importData(webBackup,options).success,true);await desktop.flush();
    const reopened=await reload('sqlite');assert.equal(reopened.fetchTasks()[0].goalId,'goal-short');assert.equal(reopened.fetchLists().find(list=>list.id==='p').archivedAt,55);
    const desktopBackup=structuredClone(reopened.exportData());
    const restoredWeb=await freshAdapter('web');assert.equal(restoredWeb.importData(desktopBackup,options).success,true);await restoredWeb.flush();
    assert.equal(restoredWeb.fetchGoals().length,2);assert.equal(restoredWeb.fetchLists().find(list=>list.id==='p').description,'Shared project context');
    assert.equal(restoredWeb.fetchTasks()[0].content,baseTask.content);
    const restored=restoredWeb.fetchLists().find(list=>list.id==='p');
    assert.equal(restored.risks,'Waiting on review');assert.deepEqual(restored.weeklyFocus,{weekOf:'2026-10-05',taskIds:['task']});assert.equal(restored.reviews[0].content,'# Lessons');assert.equal(restored.reviews[0].source,'ai');
});


test('planning: local week begins Monday; focus resets weekly and excludes moved or deleted tasks',()=>{
    assert.equal(planning.projectWeek(new Date(2026,9,11,23,59)).weekOf,'2026-10-05');
    assert.equal(planning.projectWeek(new Date(2026,9,12,0,0)).weekOf,'2026-10-12');
    const planned={...project,weeklyFocus:{weekOf:'2026-10-05',taskIds:['task','moved','trash']}};
    const tasks=[baseTask,{...baseTask,id:'moved',listId:'other'},{...baseTask,id:'trash',listName:'Trash'}];
    assert.deepEqual(planning.weeklyFocusTasks(planned,tasks,new Date(day(0))).map(task=>task.id),['task']);
    assert.deepEqual(planning.weeklyFocusTasks(planned,tasks,new Date(2026,9,12)),[]);
});
test('AI context: only current project, this week completions, and explicit safe fields are included',()=>{
    const week=planning.projectWeek(new Date(day(0)));
    const tasks=[baseTask,{...baseTask,id:'other',listId:'other',title:'PRIVATE OTHER PROJECT'}, {...baseTask,id:'trash',listName:'Trash',title:'PRIVATE TRASH'}, {...baseTask,id:'old',title:'OLD COMPLETION',completed:true,completedAt:week.start-1}, {...baseTask,id:'unknown',title:'UNKNOWN COMPLETION',completed:true,completedAt:null}, {...baseTask,id:'future',title:'FUTURE COMPLETION',completed:true,completedAt:week.end}, {...baseTask,id:'done',title:'This week done',completed:true,completedAt:week.start}];
    const context=planning.projectAIContext(project,[...goals,{...baseGoal,id:'other',projectId:'other',title:'PRIVATE GOAL'}],tasks,new Date(day(0)));
    assert.deepEqual(context.tasks.map(task=>task.title),['Task','This week done']);
    assert.equal(context.tasks[1].completedThisWeek,true);
    assert.equal(context.goals.length,2);
    assert.doesNotMatch(JSON.stringify(context),/PRIVATE|COMPLETION|Keep this/);
});
test('AI drafts: strict validation rejects malformed, duplicate and unbounded output; unknown parents are cleared',()=>{
    assert.throws(()=>planning.parseProjectDrafts('not JSON','goals',goals));
    assert.throws(()=>planning.parseProjectDrafts('[{"title":"Missing acceptance","kind":"long"}]','goals',goals));
    assert.throws(()=>planning.parseProjectDrafts('[{"title":"Same"},{"title":"Same"}]','tasks',goals));
    assert.throws(()=>planning.parseProjectDrafts(JSON.stringify(Array.from({length:13},(_,i)=>({title:String(i)}))),'tasks',goals));
    const drafts=planning.parseProjectDrafts('```json\n[{"title":"Suggestion","kind":"short","criteria":"Verify outcome","parentId":"unknown"}]\n```','goals',goals);
    assert.equal(drafts[0].parentId,null);assert.equal(drafts[0].criteria,'Verify outcome');
    assert.equal(planning.parseProjectDrafts('[{"title":"Action","id":"injected","dueDate":123,"completed":true}]','tasks',goals)[0].dueDate,undefined);
});
