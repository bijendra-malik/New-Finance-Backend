# Admin: Franchise Customers (API Reference)

Sirf Super Admin poore network ke franchise customers **read-only** dekh sakta
hai — kaun kis franchise ne register kiya aur uske loans ka status. Yahan se na
customer banta hai na loan file hota hai. Normal Admin ko `403` milta hai.

Auth: admin token (`type: "admin"`, `POST /api/admin/auth/login`).

---

## 1. List — `GET /api/admin/franchise-customers`

Query params:

| Param | Value | Meaning |
|---|---|---|
| `search` | text | fullName / mobile / panNumber / email par regex |
| `franchise` | `FRN000001` **ya** franchise ObjectId | us franchise ke customers |
| `page` | number (default 1) | |
| `limit` | 0..100 (0 = saare) | |

```
GET /api/admin/franchise-customers?franchise=FRN000001&search=rahul&page=1&limit=20
```

Response:

```json
{
  "success": true,
  "customers": [
    {
      "_id": "68f1c2…",
      "franchiseCode": "FRN000001",
      "fullName": "Rahul Sharma",
      "mobile": "9876543210",
      "panNumber": "ABCDE1234F",
      "email": "rahul@example.com",
      "franchise": { "_id": "…", "name": "Amit", "franchiseId": "FRN000001", "franchiseStatus": "Approved" },
      "loans": { "count": 2, "lastAppliedAt": "2026-10-05T00:00:00.000Z" }
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20,
  "totalPages": 1
}
```

`franchise` = owner franchise ka summary (raw ObjectId nahi).
Galat `franchise` value → `400` *"franchise must be an FRN code (e.g. FRN000001) or a franchise id"*.

---

## 2. Stats — `GET /api/admin/franchise-customers/stats`

Franchise-wise customer count + overall total.

```json
{
  "success": true,
  "stats": {
    "total": 4,
    "byFranchise": [
      { "franchise": { "_id": "…", "name": "Amit", "franchiseId": "FRN000001", "franchiseStatus": "Approved" }, "total": 3 },
      { "franchise": null, "total": 1 }
    ]
  }
}
```

`franchise: null` = wo franchise document delete ho chuka hai, par uske
customers abhi bhi hain.

---

## 3. Detail — `GET /api/admin/franchise-customers/:id`

```json
{
  "success": true,
  "customer": { "_id": "68f1c2…", "fullName": "Rahul Sharma", "panNumber": "ABCDE1234F", "…": "…" },
  "franchise": { "_id": "…", "name": "Amit", "franchiseId": "FRN000001", "franchiseStatus": "Approved" },
  "loans": {
    "total": 1,
    "byStatus": { "Submitted": 0, "Pending": 1, "Approved": 0, "Rejected": 0 },
    "data": [
      { "product": "personal", "count": 1, "applications": [ { "applicationNo": "LOAN000031", "status": "Pending", "stageKey": "under_review", "…": "…" } ] }
    ]
  }
}
```

Unknown / malformed id → `404` *"Franchise customer not found"*.

---

## Errors

| Case | Status | Message |
|---|---|---|
| no / invalid admin token | 401 | — |
| bad `franchise` filter | 400 | `franchise must be an FRN code (e.g. FRN000001) or a franchise id` |
| unknown customer id | 404 | `Franchise customer not found` |

Franchise-side flow (register + loan apply) ke liye dekhein:
`docs/FRANCHISE-CUSTOMER-API.md`.
