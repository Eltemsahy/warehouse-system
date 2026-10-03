/** Enforces module boundaries. Run: npm run lint:deps */
module.exports = {
  forbidden: [
    {
      name: "no-cross-module-internals",
      comment: "Modules may only import other modules through their public index.ts",
      severity: "error",
      from: { path: "^modules/([^/]+)/" },
      to: {
        path: "^modules/([^/]+)/",
        pathNot: ["^modules/$1/", "^modules/[^/]+/index\\.ts$"],
      },
    },
    {
      name: "domain-is-pure",
      comment: "Domain layer must not depend on application, api or infrastructure",
      severity: "error",
      from: { path: "^modules/[^/]+/domain/" },
      to: { path: "^modules/[^/]+/(api|application|infrastructure)/" },
    },
    {
      name: "application-not-on-api-or-infra",
      severity: "error",
      from: { path: "^modules/[^/]+/application/" },
      to: { path: "^modules/[^/]+/(api|infrastructure)/" },
    },
    {
      name: "shared-not-on-modules",
      severity: "error",
      from: { path: "^shared/" },
      to: { path: "^modules/" },
    },
  ],
  options: { tsConfig: { fileName: "tsconfig.json" }, doNotFollow: { path: "node_modules" } },
};
