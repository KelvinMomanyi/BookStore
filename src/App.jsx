import { Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar.jsx";
import Footer from "./components/Footer.jsx";
import CartDrawer from "./components/CartDrawer.jsx";
import WhatsAppFloat from "./components/WhatsAppFloat.jsx";
import Home from "./pages/Home.jsx";
import Store from "./pages/Store.jsx";
import BookDetails from "./pages/BookDetails.jsx";
import Admin from "./pages/Admin.jsx";
import Library from "./pages/Library.jsx";
import About from "./pages/About.jsx";
import Checkout from "./pages/Checkout.jsx";
import Contact from "./pages/Contact.jsx";
import Faqs from "./pages/Faqs.jsx";
import ShippingReturns from "./pages/ShippingReturns.jsx";
import Terms from "./pages/Terms.jsx";
import Privacy from "./pages/Privacy.jsx";
import NotFound from "./pages/NotFound.jsx";

export default function App() {
  return (
    <div className="app">
      <Navbar />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/faqs" element={<Faqs />} />
          <Route path="/shipping-returns" element={<ShippingReturns />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/store" element={<Store />} />
          <Route path="/book/:id" element={<BookDetails />} />
          <Route path="/library" element={<Library />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
      <WhatsAppFloat />
      <CartDrawer />
    </div>
  );
}
