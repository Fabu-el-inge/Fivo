globalThis.self = globalThis.self || globalThis;
globalThis.WorkerGlobalScope = globalThis.WorkerGlobalScope || function WorkerGlobalScope() {};
globalThis.location = globalThis.location || { href: "/surge/fivo-surge-wasm.js" };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.crypto = globalThis.crypto || {
    getRandomValues(view) {
        for (let i = 0; i < view.length; i++) view[i] = Math.floor(Math.random() * 256);
        return view;
    },
};
