require("./config/env");

const connectDB = require("./config/database");
const app = require("./app");

/* ============================
   Database
============================ */
connectDB();

/* ============================
   Server
============================ */
/*
`PORT=0` par express random port chun leta hai — admin panel hamesha 5000 par
request bhejta hai, isliye khaali/zero value ko default maana jaata hai.
*/
const PORT = Number(process.env.PORT) || 5000;

app.listen(PORT, () => {

    console.log("===================================");

    console.log(`🚀 Server Running On Port ${PORT}`);

    console.log(`🌍 http://localhost:${PORT}`);

    console.log("===================================");

});
