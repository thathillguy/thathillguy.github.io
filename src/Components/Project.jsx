import React from 'react';
import Paper from 'material-ui/Paper';
import '../Styles/Project.less';

import FlatButton from 'material-ui/FlatButton';
import Divider from 'material-ui/Divider';

import Modal from './Modal.jsx';


const style = {
    height: 100,
    width: 100,
    margin: 20,
    textAlign: 'center',
    display: 'inline-block',
};


export default class Project extends React.Component {
    constructor(props){
        super(props);
        this.state = {
            Modal: false,
            pname: "psize"
        }
    }
    changeModal() {
        this.setState({Modal: !this.state.Modal});
    }

    render() {
        if (this.state.Modal){
            this.pname = 'psizeplus'
        }else {
            this.pname = 'psize'
        }
        return (
            <Paper  className={this.pname} onClick={this.changeModal.bind(this)}>
                <div>
                    <Modal className='bottom' active={this.state.Modal}>
                        <Divider />
                        <FlatButton className="sourcebutton" label="Source" primary={true}/>
                        <FlatButton className="demobutton" label="Demo" primary={true}/>

                    </Modal>
                </div>
            </Paper>
        )
    }
}