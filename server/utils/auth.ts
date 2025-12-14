// Load environment variables
const API_KEY = Deno.env.get("API_KEY") || '';

export function isAuth(req: Request): boolean {
    // Validate required environment variables
    if (API_KEY === '') {
    console.error("ERROR: Environment variables not set.");
    throw new Error("Missing required environment variables");
    }
    
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return false;

    const token = authHeader.startsWith('Bearer ') 
        ? authHeader.slice(7)
        : null;

    return token === API_KEY;
}