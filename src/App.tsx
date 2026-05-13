import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Capture from "./pages/Capture";
import History from "./pages/History";
import Pin from "./pages/Pin";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/capture" element={<Capture />} />
      <Route path="/history" element={<History />} />
      <Route path="/pin" element={<Pin />} />
    </Routes>
  );
}
