import { createApp } from "vue";
import "material-symbols/outlined.css";
import "./style.css";
import { initTheme } from "./composables/useTheme";
import { router } from "./router";
import App from "./App.vue";

// Apply the persisted theme to <html> before mount so there's no flash of the
// default palette.
initTheme();

// Mount only AFTER the router's initial navigation resolves so hard reloads and
// legacy redirects render the intended board state on the first paint.
const app = createApp(App).use(router);
router.isReady().then(() => app.mount("#app"));
