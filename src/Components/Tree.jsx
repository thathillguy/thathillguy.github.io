import React from 'react';

export default class Tree extends React.Component {

    constructor(props) {
        super(props);
        this.state = {
            data: this.props.data.descendants(),
            depth: 0
        }
    }
    getPath(parent, node){
        let sign = Math.sign(node.x - parent.x);
        let path = 'M' + node.x + ', ' + node.y + ' Q ' + (parent.x - sign * 10) + ', ' + node.y + ', ' + parent.x + ', ' + parent.y;
        return path;
    }
    update(){
        this.setState({depth: this.state.depth + 1})
    }
    render() {
        const nodes = this.state.data.filter((node)=>{
            return node.depth <= this.state.depth;
        })
        console.log(nodes);
        const getPath = this.getPath;
        if (nodes.length != this.state.data.length){
            window.setTimeout(this.update.bind(this), 2000);
        }
        return (
            <g>
                {nodes.map((node, id)=> {
                    if (node.parent != null) {
                        return <path d={getPath(node, node.parent)}
                                     style={{stroke: 'rgb(255,0,0)', strokeWidth: 2, fill: 'none'}} key={id}/>
                    }
                })
                }
                {nodes.map((node, id)=> {
                    return <circle className="dot" r={node.value + 35 + 'px'} cx={node.x} cy={node.y}
                                   fill={node.data.type}
                                   stroke={node.data.level} strokeWidth="5px" key={id}/>
                    })
                }

            </g>
        );
    }
}
