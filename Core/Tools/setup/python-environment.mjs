import {join,resolve} from 'node:path';

export function uvPythonEnvironment(workspace,env=process.env){
 return {...env,UV_PYTHON_INSTALL_DIR:env.UV_PYTHON_INSTALL_DIR??join(resolve(workspace),'Plugins/Engines/python')};
}
