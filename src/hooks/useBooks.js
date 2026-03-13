import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase.js";

export const useBooks = (limitCount) => {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      setLoading(true);
      try {
        const snapshot = await getDocs(collection(db, "books"));
        let results = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        results = results.sort((a, b) => {
          const aTime = a.createdAt?.seconds ?? 0;
          const bTime = b.createdAt?.seconds ?? 0;
          return bTime - aTime;
        });
        if (limitCount) {
          results = results.slice(0, limitCount);
        }
        if (isMounted) {
          setBooks(results);
        }
      } catch (err) {
        if (isMounted) {
          setError(err);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      isMounted = false;
    };
  }, [limitCount]);

  return { books, loading, error };
};
