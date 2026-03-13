import React, { createContext, useContext, useMemo, useState } from "react";

const CartContext = createContext(null);

const clampQty = (qty) => Math.min(99, Math.max(1, qty));

export const CartProvider = ({ children }) => {
  const [items, setItems] = useState([]);
  const [isOpen, setIsOpen] = useState(false);

  const addToCart = (book) => {
    setItems((prev) => {
      const existing = prev.find((item) => item.id === book.id);
      if (existing) {
        return prev.map((item) =>
          item.id === book.id ? { ...item, qty: clampQty(item.qty + 1) } : item
        );
      }
      return [...prev, { ...book, qty: 1 }];
    });
    setIsOpen(true);
  };

  const removeFromCart = (id) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const updateQty = (id, qty) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, qty: clampQty(qty) } : item))
    );
  };

  const clearCart = () => setItems([]);
  const openCart = () => setIsOpen(true);
  const closeCart = () => setIsOpen(false);
  const toggleCart = () => setIsOpen((prev) => !prev);

  const summary = useMemo(() => {
    const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const count = items.reduce((sum, item) => sum + item.qty, 0);
    return { subtotal, count };
  }, [items]);

  const value = {
    items,
    isOpen,
    addToCart,
    removeFromCart,
    updateQty,
    clearCart,
    openCart,
    closeCart,
    toggleCart,
    summary
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

export const useCart = () => {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error("useCart must be used within CartProvider");
  }
  return ctx;
};
