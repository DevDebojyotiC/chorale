// Reference solution for the `store` project — used only by projects-selftest.ts.
export function createStore(reducer, preloadedState, enhancer) {
  if (typeof enhancer === "function") return enhancer(createStore)(reducer, preloadedState);
  let state = reducer(preloadedState, { type: "@@INIT" });
  let listeners = [];
  const getState = () => state;
  const dispatch = (action) => { state = reducer(state, action); listeners.forEach((l) => l()); return action; };
  const subscribe = (l) => { listeners.push(l); return () => { listeners = listeners.filter((x) => x !== l); }; };
  return { getState, dispatch, subscribe };
}

export function combineReducers(reducers) {
  const keys = Object.keys(reducers);
  return (state = {}, action) => {
    const next = {};
    for (const k of keys) next[k] = reducers[k](state[k], action);
    return next;
  };
}

export function applyMiddleware(...middlewares) {
  return (createStoreFn) => (reducer, preloadedState) => {
    const store = createStoreFn(reducer, preloadedState);
    let dispatch = store.dispatch;
    const api = { getState: store.getState, dispatch: (a) => dispatch(a) };
    const chain = middlewares.map((mw) => mw(api));
    dispatch = chain.reduceRight((next, mw) => mw(next), store.dispatch);
    return { ...store, dispatch };
  };
}
