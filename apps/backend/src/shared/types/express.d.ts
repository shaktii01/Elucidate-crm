declare global {
  namespace Express {
    interface Request {
      user: { _id: string; id?: string; name: string; email: string; role: 'ADMIN' | 'SALESPERSON'; active: boolean }
    }
  }
}

export {}
