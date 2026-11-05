const http = require("node:http");
const app = require("../src/app");
const User = require("../src/modules/auth/user.model");

let server;

const request = (path) =>
  new Promise((resolve, reject) => {
    http
      .get(
        {
          host: "127.0.0.1",
          port: server.address().port,
          path,
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("end", () => {
            resolve({
              status: response.statusCode,
              body: JSON.parse(body),
            });
          });
        }
      )
      .on("error", reject);
  });

beforeAll((done) => {
  app.get("/__test/query", (req, res) => res.json(req.query));
  server = app.listen(0, done);
});

afterAll((done) => {
  server.close(done);
});

describe("app security middleware", () => {
  it("sanitizes query operators without throwing on Express 5", async () => {
    const response = await request("/__test/query?%24gt=operator&safe=value");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ safe: "value" });
  });

  it("keeps a single customerId index", () => {
    const customerIdIndexes = User.schema
      .indexes()
      .filter(([fields]) => fields.customerId);

    expect(customerIdIndexes).toHaveLength(1);
    expect(customerIdIndexes[0][1]).toMatchObject({
      unique: true,
      sparse: true,
    });
  });
});
