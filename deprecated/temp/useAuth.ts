// Re-exports useAuth from AuthProvider so that consuming files
// import from a stable path (this file) rather than reaching
// into AuthProvider's internals. If the auth module is ever
// restructured, only this file needs to change.
export { useAuth } from './AuthProvider'
