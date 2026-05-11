export interface Config {
  /** kebab-case project name, e.g. "my-app" */
  name: string;
  /** npm scope, e.g. "@my-app" */
  scope: string;
  /** PascalCase namespace for window.X global, e.g. "MyApp" */
  namespace: string;
  /** The origin where the widget iframe will be hosted */
  widgetOrigin: string;
  /** Optional package author */
  author: string;
  /** Optional package description */
  description: string;
  /** Whether to scaffold the React adapter package */
  includeReact: boolean;
  /** Whether to scaffold the example host app */
  includeExample: boolean;
  /** Output directory (absolute path) */
  outDir: string;
}
