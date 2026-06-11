import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Swords } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center space-y-6 animate-fade-in">
        <Swords className="w-16 h-16 text-primary mx-auto opacity-50" />
        <h1 className="text-6xl font-display uppercase tracking-widest text-gradient">404</h1>
        <p className="text-lg text-muted-foreground">Página no encontrada</p>
        <Link
          to="/"
          className="inline-block px-6 py-3 bg-gradient-primary rounded-lg text-sm font-semibold uppercase tracking-wider hover:opacity-90 transition-opacity"
        >
          Volver al Inicio
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
