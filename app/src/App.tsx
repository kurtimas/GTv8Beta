import { Routes, Route } from "react-router";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Sheets from "./pages/Sheets";
import Bins from "./pages/Bins";
import People from "./pages/People";
import Reports from "./pages/Reports";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/sheets" element={<Sheets />} />
        <Route path="/bins" element={<Bins />} />
        <Route path="/people" element={<People />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
