import "./App.css";
import { PlayerView } from "./features/player/PlayerView";
import { OptionsWindow } from "./features/settings/OptionsWindow";

export default function App() {
  const windowType = new URLSearchParams(window.location.search).get("window");
  if (windowType === "options") {
    return <OptionsWindow />;
  }
  return <PlayerView />;
}
