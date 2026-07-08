import { Router } from "express";
import { postCondicionesHipotecas } from "../controllers/workflow_controller.js";

const workflowRouter = Router();

workflowRouter.post("/condiciones-hipotecas", postCondicionesHipotecas);

export default workflowRouter;
