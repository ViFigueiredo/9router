// Branding constants shared by the server layout (metadata) and the client
// provider. Kept outside the "use client" module: importing a value out of a
// client module from a server component throws at runtime.
export const DEFAULT_TITLE = "9Router - AI Infrastructure Management";
export const DEFAULT_FAVICON = "/favicon.svg";
export const TITLE_SUFFIX = "AI Infrastructure Management";
// Fired by the settings page after saving so the change applies without a reload.
export const BRANDING_EVENT = "9r:branding-updated";
