// dsh-deepworker (DeepWorker) node half.
//
// Pure UI plugin: the empty apply exists so the plugin appears in the host Loader; the
// browser half ships via exports["./client"], discovered through the package.json
// `dsh.client` declaration.
//
// The focus lock used to live here. It is now client-side only (the service-level
// interceptor in lib/client.js); the old host guard was retired and its package removed.
function apply() {}
export { apply };
