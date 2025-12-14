export function isAuth(req: Request): boolean {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return false;

    const token = authHeader.startsWith('Bearer ') 
        ? authHeader.slice(7)
        : null;

    return token === API_KEY;
}